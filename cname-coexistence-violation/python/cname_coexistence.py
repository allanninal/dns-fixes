"""Detect a CNAME coexisting with another record type at the same name,
and optionally repair it via Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the name to check, e.g. "app.example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("cname_coexistence")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def find_cname_coexistence_violations(records):
    """Pure decision function. No I/O.

    records: list of {"name": str, "type": str, "id": str}

    Groups records by lowercased name. For each group, if any record has
    type "CNAME" and the group has more than one record, returns that name
    together with the ids and types of every non-CNAME record in the group
    (these are the ones to remove or relocate).

    Returns a list of {"name": str, "conflicting_ids": list[str], "types": list[str]}.
    """
    groups = {}
    for rec in records:
        key = rec["name"].lower()
        groups.setdefault(key, []).append(rec)

    violations = []
    for name, group in groups.items():
        has_cname = any(r["type"] == "CNAME" for r in group)
        if has_cname and len(group) > 1:
            others = [r for r in group if r["type"] != "CNAME"]
            violations.append({
                "name": name,
                "conflicting_ids": [r["id"] for r in others],
                "types": [r["type"] for r in others],
            })
    return violations


def query_records_at_name(domain):
    """Query the common record types at a single name. Requires network."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    rtypes = ["CNAME", "A", "AAAA", "MX", "TXT"]
    found = []
    for rtype in rtypes:
        try:
            answer = resolver.resolve(domain, rtype)
            for _ in answer:
                found.append({"name": domain, "type": rtype, "id": f"{domain}:{rtype}"})
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            continue
        except Exception as exc:
            log.warning("Query for %s %s failed: %s", domain, rtype, exc)
    return found


def list_zone_records():
    """List every DNS record in the Cloudflare zone."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"per_page": 5000}, timeout=30)
    r.raise_for_status()
    return [
        {"name": rec["name"], "type": rec["type"], "id": rec["id"]}
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
        log.warning("No Cloudflare credentials set. Checking DNS only for %s.", DNS_DOMAIN)
        records = query_records_at_name(DNS_DOMAIN)
    else:
        records = list_zone_records()

    violations = find_cname_coexistence_violations(records)
    if not violations:
        log.info("No CNAME coexistence violations found.")
        return

    for v in violations:
        log.warning(
            "%s has a CNAME plus %s (%d record(s) to remove or relocate)",
            v["name"], ", ".join(v["types"]), len(v["conflicting_ids"]),
        )
        if CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID:
            for record_id in v["conflicting_ids"]:
                delete_record(record_id)

    log.info("Done. %d name(s) had a conflict.", len(violations))


if __name__ == "__main__":
    run()
