"""Detect a DNS record whose TTL is set high enough to delay an urgent
change by hours, and optionally repair the zone via Cloudflare by
lowering that record's TTL well ahead of the real change.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
  SAFE_TTL_SECONDS         TTL to lower flagged records to, default 300
  TTL_THRESHOLD_SECONDS    TTL above this is flagged, default 3600
  DNS_RECORD_TYPE          record type to check, default "A"
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ttl_too_high")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
SAFE_TTL_SECONDS = int(os.environ.get("SAFE_TTL_SECONDS", "300"))
TTL_THRESHOLD_SECONDS = int(os.environ.get("TTL_THRESHOLD_SECONDS", "3600"))

CF_API = "https://api.cloudflare.com/client/v4"


def classify_ttl(current_ttl, threshold_seconds):
    """Pure decision function. No I/O.

    current_ttl: the record's TTL in seconds, as returned by DNS or the
      provider API. A TTL of 1 from some providers means "automatic"
      and is treated the same as a safe, already-low TTL.
    threshold_seconds: any TTL strictly above this is flagged as risky.

    Returns one of "safe" or "high_ttl".
    """
    if current_ttl is None or current_ttl <= 1:
        return "safe"
    if current_ttl > threshold_seconds:
        return "high_ttl"
    return "safe"


def lookup_ttl(domain, record_type="A"):
    """Return the TTL in seconds for the first answer of record_type."""
    import dns.resolver

    answer = dns.resolver.resolve(domain, record_type)
    return int(answer.rrset.ttl)


def list_zone_records(domain, record_type="A"):
    """List the id, ttl, and content of matching records via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": record_type, "name": domain, "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]


def lower_ttl(record_id, domain, record_type, content, new_ttl):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    body = {"type": record_type, "name": domain, "content": content, "ttl": new_ttl}
    if DRY_RUN:
        log.info("[dry run] would lower record %s to TTL %s", record_id, new_ttl)
        return
    r = requests.patch(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Lowered record %s to TTL %s", record_id, new_ttl)


def run(record_type="A"):
    ttl = lookup_ttl(DNS_DOMAIN, record_type)
    verdict = classify_ttl(ttl, TTL_THRESHOLD_SECONDS)
    log.info("%s record for %s has TTL %s seconds: %s", record_type, DNS_DOMAIN, ttl, verdict)

    if verdict == "safe":
        log.info("TTL is already at or below the safe threshold. No repair needed.")
        return

    log.warning(
        "TTL of %s seconds on %s is above the %s second threshold. "
        "An urgent change to this record could take hours to reach everyone.",
        ttl, DNS_DOMAIN, TTL_THRESHOLD_SECONDS,
    )

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    zone_records = list_zone_records(DNS_DOMAIN, record_type)
    for rec in zone_records:
        lower_ttl(rec["id"], DNS_DOMAIN, record_type, rec["content"], SAFE_TTL_SECONDS)
    log.info("Done.")


if __name__ == "__main__":
    run(record_type=os.environ.get("DNS_RECORD_TYPE", "A"))
