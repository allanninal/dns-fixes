"""Detect MX records left behind by a decommissioned mail provider
after a migration, and optionally repair the zone via Cloudflare by
deleting those leftover records.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  INTENDED_MX_SUFFIXES     comma separated hostname suffixes that
                           belong to the intended/current provider,
                           e.g. "google.com." or
                           "mail.protection.outlook.com."
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("leftover_mx_records_after_migration")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
INTENDED_MX_SUFFIXES = [
    s.strip() for s in os.environ.get("INTENDED_MX_SUFFIXES", "google.com.").split(",") if s.strip()
]
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def _normalize(host):
    return host.strip().lower().rstrip(".") + "."


def find_leftover_mx(live_mx, intended_suffixes):
    """Pure decision function. No I/O.

    live_mx: list of (priority, exchange_host) tuples currently returned
             by a live MX lookup, e.g.
             [(1, 'smtp.google.com.'), (10, 'mx1.oldprovider.net.')]
    intended_suffixes: list of hostname suffixes that belong to the
             intended/current provider, e.g. ['google.com.'] or
             ['mail.protection.outlook.com.']

    Returns the subset of live_mx entries whose exchange host does NOT
    end with any of the intended_suffixes (case-insensitive,
    trailing-dot normalized), i.e. the leftover records from the
    decommissioned provider that should be deleted.
    """
    normalized_suffixes = [_normalize(s) for s in intended_suffixes]
    leftovers = []
    for priority, exchange in live_mx:
        host = _normalize(exchange)
        if not any(host.endswith(suffix) for suffix in normalized_suffixes):
            leftovers.append((priority, exchange))
    return leftovers


def fetch_mx_records(domain):
    """Return a list of (priority, exchange) tuples for the domain."""
    import dns.resolver

    answers = dns.resolver.resolve(domain, "MX")
    return [(rdata.preference, str(rdata.exchange)) for rdata in answers]


def list_mx_zone_records(domain):
    """List the id, priority, and content of every MX record via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": "MX", "name": domain, "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]


def delete_record(record_id):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted record %s", record_id)


def run():
    live_mx = fetch_mx_records(DNS_DOMAIN)
    if not live_mx:
        log.info("No MX records found for %s.", DNS_DOMAIN)
        return

    leftovers = find_leftover_mx(live_mx, INTENDED_MX_SUFFIXES)
    if not leftovers:
        log.info("All %d MX record(s) for %s match the intended provider.", len(live_mx), DNS_DOMAIN)
        return

    for priority, exchange in leftovers:
        log.warning("Leftover MX record for %s: priority %s exchange %r", DNS_DOMAIN, priority, exchange)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    zone_records = list_mx_zone_records(DNS_DOMAIN)
    leftover_hosts = {_normalize(exchange) for _, exchange in leftovers}
    for rec in zone_records:
        if _normalize(rec["content"]) in leftover_hosts:
            delete_record(rec["id"])
    log.info("Done. %d leftover record(s) %s.", len(leftovers), "would be removed" if DRY_RUN else "removed")


if __name__ == "__main__":
    run()
