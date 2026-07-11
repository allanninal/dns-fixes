"""Detect a literal CNAME at a zone apex and optionally repair it via Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the zone apex to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  REPLACEMENT_IP           IP address to use for the replacement A record
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("apex_cname_conflict")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def classify_apex_cname_conflict(apex_records):
    """Pure decision function. No I/O.

    apex_records looks like:
      {"CNAME": ["target.example.net"], "NS": [...], "SOA": [...], "A": []}

    Returns one of:
      "ok"                     - no CNAME present, NS and SOA present
      "conflict_literal_cname" - CNAME present and NS/SOA missing or empty
      "flattened_ok"           - CNAME configured upstream but A/AAAA plus
                                  NS/SOA are intact (provider flattening works)
    """
    cname = apex_records.get("CNAME") or []
    ns = apex_records.get("NS") or []
    soa = apex_records.get("SOA") or []
    a = apex_records.get("A") or []
    aaaa = apex_records.get("AAAA") or []

    if not cname:
        if ns and soa:
            return "ok"
        return "conflict_literal_cname"

    if ns and soa and (a or aaaa):
        return "flattened_ok"

    return "conflict_literal_cname"


def query_apex_records(domain):
    """Query CNAME, A, AAAA, NS, and SOA at the zone apex. Requires network."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    records = {"CNAME": [], "A": [], "AAAA": [], "NS": [], "SOA": []}
    for rtype in records:
        try:
            answer = resolver.resolve(domain, rtype)
            records[rtype] = [str(r) for r in answer]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            records[rtype] = []
        except Exception as exc:
            log.warning("Query for %s %s failed: %s", domain, rtype, exc)
            records[rtype] = []
    return records


def find_apex_cname_record_id(domain):
    """Find the offending CNAME record via the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": "CNAME", "name": domain}, timeout=30)
    r.raise_for_status()
    result = r.json().get("result", [])
    return result[0]["id"] if result else None


def replace_apex_cname(domain, record_id, replacement_ip):
    """Delete the literal apex CNAME and create an A record instead."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    base = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"

    if DRY_RUN:
        log.info("[dry run] would delete CNAME record %s at %s", record_id, domain)
        log.info("[dry run] would create A record %s -> %s", domain, replacement_ip)
        return

    requests.delete(f"{base}/{record_id}", headers=headers, timeout=30).raise_for_status()
    requests.post(
        base,
        headers=headers,
        json={"type": "A", "name": domain, "content": replacement_ip, "ttl": 300, "proxied": False},
        timeout=30,
    ).raise_for_status()
    log.info("Replaced apex CNAME with A record %s -> %s", domain, replacement_ip)


def run():
    records = query_apex_records(DNS_DOMAIN)
    verdict = classify_apex_cname_conflict(records)
    log.info("Apex %s classified as: %s", DNS_DOMAIN, verdict)

    if verdict != "conflict_literal_cname":
        log.info("Nothing to repair.")
        return

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("Conflict found but no Cloudflare credentials set. Skipping repair.")
        return

    record_id = find_apex_cname_record_id(DNS_DOMAIN)
    if not record_id:
        log.warning("Could not find the CNAME record via the Cloudflare API.")
        return

    replacement_ip = os.environ.get("REPLACEMENT_IP", "203.0.113.10")
    replace_apex_cname(DNS_DOMAIN, record_id, replacement_ip)


if __name__ == "__main__":
    run()
