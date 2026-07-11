"""Detect a wildcard CNAME pointing at a deprovisioned service and optionally
delete it via Cloudflare. Safe by default. Set DRY_RUN=false to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dangling_wildcard")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"

KNOWN_VULNERABLE_FINGERPRINTS = {
    "no such app",
    "nosuchbucket",
    "there isn't a github pages site here",
    "unrecognized domain",
}


def is_dangling_wildcard(record, resolved_target_status, http_fingerprint, known_vulnerable_fingerprints):
    """Pure decision function. No I/O.

    record: dict, must have name starting with "*" and type "CNAME".
    resolved_target_status: one of "NXDOMAIN", "SERVFAIL", "OK", pre-resolved
      by the caller via dns.resolver.
    http_fingerprint: a lowercase string from the target's HTTP response, or
      None if no request was made.
    known_vulnerable_fingerprints: set of known "unclaimed resource" strings.

    Returns True if the wildcard CNAME target is dangling.
    """
    if not record.get("name", "").startswith("*"):
        return False
    if record.get("type") != "CNAME":
        return False
    if resolved_target_status != "OK":
        return True
    if http_fingerprint in known_vulnerable_fingerprints:
        return True
    return False


def list_cname_records():
    """List every CNAME record in the zone via the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": "CNAME"}, timeout=30)
    r.raise_for_status()
    return r.json().get("result", [])


def resolve_target_status(hostname):
    """Resolve a CNAME target and classify it as OK, NXDOMAIN, or SERVFAIL."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    try:
        resolver.resolve(hostname, "A")
        return "OK"
    except dns.resolver.NXDOMAIN:
        return "NXDOMAIN"
    except dns.resolver.NoAnswer:
        return "OK"
    except Exception as exc:
        log.warning("Resolving %s failed: %s", hostname, exc)
        return "SERVFAIL"


def probe_http_fingerprint(hostname):
    """Fetch the hostname over HTTPS and return a lowercase fingerprint string."""
    import requests

    try:
        resp = requests.get(f"https://{hostname}/", timeout=10)
        return resp.text.lower()
    except Exception as exc:
        log.warning("HTTP probe for %s failed: %s", hostname, exc)
        return ""


def delete_record(record_id):
    """Delete a dangling wildcard record through the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"

    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return

    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted dangling wildcard record %s", record_id)


def run():
    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Nothing to scan.")
        return

    records = list_cname_records()
    flagged = 0
    for record in records:
        if not record.get("name", "").startswith("*"):
            continue
        target = record.get("content", "")
        status = resolve_target_status(target)
        fingerprint = probe_http_fingerprint(target) if status == "OK" else ""
        dangling = is_dangling_wildcard(record, status, fingerprint, KNOWN_VULNERABLE_FINGERPRINTS)
        if dangling:
            log.info("Wildcard %s -> %s is dangling (%s)", record["name"], target, status)
            delete_record(record["id"])
            flagged += 1
        else:
            log.info("Wildcard %s -> %s looks fine", record["name"], target)

    log.info("Done. %d dangling wildcard(s) %s.", flagged, "to remove" if DRY_RUN else "removed")


if __name__ == "__main__":
    run()
