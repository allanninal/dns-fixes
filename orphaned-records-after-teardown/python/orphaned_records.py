"""Detect DNS records left behind after a service teardown, and optionally
repair the zone via Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the zone to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  LIVE_INVENTORY           comma separated list of hostnames/IPs currently
                           provisioned, e.g. from a cloud API or CMDB
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("orphaned_records")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
LIVE_INVENTORY = {
    item.strip().lower() for item in os.environ.get("LIVE_INVENTORY", "").split(",") if item.strip()
}
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"

UNCLAIMED_FINGERPRINTS = {
    "s3-website-us-east-1.amazonaws.com": "NoSuchBucket",
    "herokuapp.com": "no-such-app",
    "github.io": "There isn't a GitHub Pages site here",
}


def classify_record(record, live_inventory, unclaimed_fingerprints):
    """Pure decision function. No I/O.

    record: {"type": "CNAME"|"A"|"AAAA", "name": str, "content": str}
    live_inventory: set of hostnames/IPs currently provisioned (from a
      cloud API or CMDB snapshot), already lowercased with no trailing dot.
    unclaimed_fingerprints: {provider_domain_suffix: expected_404_body_substring}
      for known dangling signatures.

    Returns one of "orphaned", "active", "needs_manual_review".
    """
    target = record["content"].rstrip(".").lower()

    if target in live_inventory:
        return "active"

    for suffix in unclaimed_fingerprints:
        if target.endswith(suffix) and target not in live_inventory:
            return "orphaned"

    return "needs_manual_review"


def list_zone_records():
    """List CNAME, A, and AAAA records in the zone via the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    records = []
    for record_type in ("CNAME", "A", "AAAA"):
        r = requests.get(
            f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
            headers=headers, params={"type": record_type, "per_page": 5000}, timeout=30,
        )
        r.raise_for_status()
        for rec in r.json().get("result", []):
            records.append({
                "id": rec["id"], "type": rec["type"], "name": rec["name"], "content": rec["content"],
            })
    return records


def delete_record(record_id):
    """Delete a single DNS record through the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted orphaned record %s", record_id)


def run():
    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Nothing to scan for %s.", DNS_DOMAIN)
        return

    records = list_zone_records()
    orphaned = 0
    for record in records:
        verdict = classify_record(record, LIVE_INVENTORY, UNCLAIMED_FINGERPRINTS)
        if verdict == "orphaned":
            log.info("%s -> %s is orphaned", record["name"], record["content"])
            delete_record(record["id"])
            orphaned += 1
        elif verdict == "needs_manual_review":
            log.warning("%s -> %s needs manual review", record["name"], record["content"])
        else:
            log.info("%s -> %s is active", record["name"], record["content"])

    log.info("Done. %d orphaned record(s) %s.", orphaned, "to remove" if DRY_RUN else "removed")


if __name__ == "__main__":
    run()
