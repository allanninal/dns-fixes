"""Detect a CAA record that blocks the intended certificate authority and,
on repair, add the missing issue record through the Cloudflare API. Safe to
run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("caa_blocks_intended_ca")


def caa_permits_ca(records, intended_ca_domain, is_wildcard=False):
    """Pure decision function. No DNS I/O, no network calls.

    records: list of (tag, value) pairs from the nearest non-empty CAA
             RRset found while walking up the DNS tree from the target
             name to the apex (empty list means no CAA record exists
             anywhere, so any CA is permitted).
    intended_ca_domain: the CA's CAA identifier, e.g. "letsencrypt.org",
             "digicert.com", "pki.goog".
    is_wildcard: True if the certificate being requested is a wildcard
             cert (checks the "issuewild" tag, falling back to "issue"
             per RFC 8659 if no issuewild record is present).

    Returns (permitted: bool, reason: str).
    """
    if not records:
        return True, "no CAA record anywhere in the tree, any CA is permitted"

    tag = "issuewild" if is_wildcard else "issue"
    tagged = [value for record_tag, value in records if record_tag == tag]

    if is_wildcard and not tagged:
        tagged = [value for record_tag, value in records if record_tag == "issue"]
        tag = "issue"

    if not tagged:
        return True, f"no {tag} record present, so no restriction applies to this tag"

    for value in tagged:
        if value.strip() == ";":
            return False, f'{tag} record is empty (0 {tag} ";")'

    for value in tagged:
        ca_part = value.split(";", 1)[0].strip()
        if ca_part == intended_ca_domain:
            return True, f"{tag} record names {intended_ca_domain}"

    return False, f"no {tag} record names {intended_ca_domain}"


def _climb_labels(name):
    labels = name.rstrip(".").split(".")
    for i in range(len(labels) - 1):
        yield ".".join(labels[i:])
    yield labels[-1]


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    name = os.environ["DNS_DOMAIN"]
    intended_ca = os.environ.get("INTENDED_CA", "letsencrypt.org")
    is_wildcard = os.environ.get("IS_WILDCARD", "false").lower() == "true"
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    resolver = dns.resolver.Resolver()
    records = []
    checked_name = name
    for candidate in _climb_labels(name):
        try:
            answer = resolver.resolve(candidate, "CAA")
            records = [(r.tag.decode() if isinstance(r.tag, bytes) else r.tag,
                        r.value.decode() if isinstance(r.value, bytes) else r.value)
                       for r in answer]
            checked_name = candidate
            break
        except dns.resolver.NoAnswer:
            continue
        except dns.resolver.NXDOMAIN:
            continue

    permitted, reason = caa_permits_ca(records, intended_ca, is_wildcard)
    log.info("CAA at %s: %s", checked_name, reason)

    if permitted:
        log.info("No fix needed. %s is already permitted to issue.", intended_ca)
        return

    log.warning("Blocked: %s", reason)

    if dry_run:
        log.info(
            "Dry run: would add CAA 0 %s \"%s\" to %s",
            "issuewild" if is_wildcard else "issue", intended_ca, name,
        )
        return

    resp = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        json={
            "type": "CAA",
            "name": name,
            "data": {
                "flags": 0,
                "tag": "issuewild" if is_wildcard else "issue",
                "value": intended_ca,
            },
            "ttl": 3600,
        },
        timeout=30,
    )
    resp.raise_for_status()
    log.info("Added CAA record permitting %s to issue for %s", intended_ca, name)


if __name__ == "__main__":
    run()
