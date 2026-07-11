"""Detect an issuewild CAA record that blocks wildcard certificate issuance
and, on repair, correct it through the Cloudflare API. Safe to run on a
schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("wildcard_caa_check")


def wildcard_caa_blocked(caa_records, desired_ca):
    """Pure decision function. No network, no I/O.

    caa_records is a list of (flags, tag, value) tuples parsed from the
    apex CAA RRset. desired_ca is the CA identification domain the ACME
    client will use, such as "letsencrypt.org".

    Returns (True, reason) if any issuewild record exists whose value is
    not desired_ca or equals ";" (explicit deny), while at least one
    issue record equals desired_ca. That combination means non-wildcard
    issuance would succeed but wildcard issuance would fail.

    Returns (False, "") otherwise: no issuewild present, or issuewild
    already matches desired_ca.
    """
    issue_values = [value for (_, tag, value) in caa_records if tag == "issue"]
    issuewild_values = [value for (_, tag, value) in caa_records if tag == "issuewild"]

    if not issuewild_values:
        return (False, "")

    if desired_ca not in issue_values:
        return (False, "")

    for value in issuewild_values:
        if value == ";":
            return (True, f"issuewild is set to deny all wildcard issuers (\";\"), but issue allows {desired_ca}")
        if value != desired_ca:
            return (True, f"issuewild names {value}, which does not match the issue value {desired_ca}")

    return (False, "")


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    zone_apex = os.environ["DNS_DOMAIN"]
    desired_ca = os.environ.get("DESIRED_CA", "letsencrypt.org")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    answer = dns.resolver.resolve(zone_apex, "CAA")
    caa_records = []
    for rdata in answer:
        tag = rdata.tag.decode() if isinstance(rdata.tag, bytes) else rdata.tag
        value = rdata.value.decode() if isinstance(rdata.value, bytes) else rdata.value
        caa_records.append((rdata.flags, tag, value))

    blocked, reason = wildcard_caa_blocked(caa_records, desired_ca)
    if not blocked:
        log.info("No wildcard-blocking issuewild mismatch found for %s", zone_apex)
        return

    log.warning("Wildcard issuance blocked for %s: %s", zone_apex, reason)

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    resp = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        params={"type": "CAA"},
        timeout=30,
    )
    resp.raise_for_status()
    records = resp.json()["result"]

    offending = next((r for r in records if r.get("data", {}).get("tag") == "issuewild"), None)

    if dry_run:
        if offending:
            log.info("Dry run: would update record %s issuewild to %s", offending["id"], desired_ca)
        else:
            log.info("Dry run: would create a new issuewild record set to %s", desired_ca)
        return

    payload = {
        "type": "CAA",
        "name": zone_apex,
        "data": {"flags": 0, "tag": "issuewild", "value": desired_ca},
    }

    if offending:
        put_resp = requests.put(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{offending['id']}",
            headers=headers,
            json=payload,
            timeout=30,
        )
        put_resp.raise_for_status()
        log.info("Updated issuewild record for %s to %s", zone_apex, desired_ca)
    else:
        post_resp = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers=headers,
            json=payload,
            timeout=30,
        )
        post_resp.raise_for_status()
        log.info("Created issuewild record for %s set to %s", zone_apex, desired_ca)


if __name__ == "__main__":
    run()
