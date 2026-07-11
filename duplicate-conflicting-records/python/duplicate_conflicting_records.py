"""Detect duplicate or conflicting DNS records at a single name, and
optionally repair the zone via Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the name to check, e.g. "app.example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  EXPECTED_IPS             comma separated list of IPs that are allowed
                           for A/AAAA records at this name (round robin ok)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("duplicate_conflicting_records")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
EXPECTED_IPS = [ip.strip() for ip in os.environ.get("EXPECTED_IPS", "").split(",") if ip.strip()]
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def detect_duplicate_conflict(records, expected_ips=None):
    """Pure decision function. No I/O.

    records: list of {"type": str, "name": str, "content": str, "id": str}
    expected_ips: optional list of IPs that are allowed for A/AAAA records
                  at this name (an intentional round robin set).

    Groups records by exact name. Returns:
      {"conflict": True, "reason": "cname_coexistence", "to_remove": [ids]}
        when a CNAME is present alongside any other type at that name.
      {"conflict": True, "reason": "ambiguous_duplicate_ip", "to_remove": [ids]}
        when 2+ A or 2+ AAAA records exist at the name and at least one
        content value is not in expected_ips.
      {"conflict": False, "reason": "", "to_remove": []} otherwise.
    """
    expected_ips = set(expected_ips or [])
    groups = {}
    for rec in records:
        groups.setdefault(rec["name"], []).append(rec)

    for name, group in groups.items():
        has_cname = any(r["type"] == "CNAME" for r in group)
        if has_cname and len(group) > 1:
            to_remove = [r["id"] for r in group if r["type"] != "CNAME"]
            return {"conflict": True, "reason": "cname_coexistence", "to_remove": to_remove}

        for rtype in ("A", "AAAA"):
            same_type = [r for r in group if r["type"] == rtype]
            if len(same_type) < 2:
                continue
            if expected_ips and any(r["content"] not in expected_ips for r in same_type):
                to_remove = [r["id"] for r in same_type if r["content"] not in expected_ips]
                return {"conflict": True, "reason": "ambiguous_duplicate_ip", "to_remove": to_remove}

    return {"conflict": False, "reason": "", "to_remove": []}


def list_zone_records(name=None):
    """List DNS records in the Cloudflare zone, optionally filtered by name."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"per_page": 5000}
    if name:
        params["name"] = name
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return [
        {"name": rec["name"], "type": rec["type"], "content": rec["content"], "id": rec["id"]}
        for rec in r.json()["result"]
    ]


def delete_record(record_id):
    """Delete a single DNS record through the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted record %s", record_id)


def run():
    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Nothing to check for %s.", DNS_DOMAIN)
        return

    records = list_zone_records(DNS_DOMAIN)
    result = detect_duplicate_conflict(records, EXPECTED_IPS)

    if not result["conflict"]:
        log.info("No duplicate or conflicting records found for %s.", DNS_DOMAIN)
        return

    log.warning(
        "%s has a conflict (%s), %d record(s) to remove",
        DNS_DOMAIN, result["reason"], len(result["to_remove"]),
    )
    for record_id in result["to_remove"]:
        delete_record(record_id)

    log.info("Done.")


if __name__ == "__main__":
    run()
