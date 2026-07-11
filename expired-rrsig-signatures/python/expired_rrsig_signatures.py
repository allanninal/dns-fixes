"""Detect RRSIG signatures that have expired or are close to expiring, and
optionally trigger a re-sign through the Cloudflare DNS API. Safe by
default. Set DRY_RUN=false to let it write.
"""
import os
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("expired_rrsig_signatures")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
RECORD_TYPE = os.environ.get("RECORD_TYPE", "A")
WARN_HOURS = int(os.environ.get("WARN_HOURS", "48"))
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def check_rrsig_expiration(expiration, now, warn_hours):
    """Pure decision function. No I/O.

    expiration: aware datetime, the RRSIG record's expiration timestamp
    now: aware datetime, the current time to compare against
    warn_hours: int, how many hours before expiration counts as "soon"

    Returns one of "expired", "expiring_soon", or "ok".
    """
    remaining = (expiration - now).total_seconds() / 3600
    if remaining <= 0:
        return "expired"
    if remaining <= warn_hours:
        return "expiring_soon"
    return "ok"


def query_rrsig_expiration(domain, record_type):
    """Query the RRSIG record for a name and return its expiration as an
    aware UTC datetime. Requires network.
    """
    import dns.resolver
    import dns.rdatatype

    answer = dns.resolver.resolve(domain, "RRSIG")
    for rdata in answer:
        if dns.rdatatype.to_text(rdata.type_covered) == record_type:
            return datetime.fromtimestamp(rdata.expiration, tz=timezone.utc)
    raise LookupError(f"No RRSIG covering {record_type} found for {domain}")


def get_cloudflare_dnssec_status(zone_id, token):
    """Read the current DNSSEC status for a Cloudflare zone."""
    import requests

    headers = {"Authorization": f"Bearer {token}"}
    url = f"{CF_API}/zones/{zone_id}/dnssec"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("result", {})


def trigger_resign(zone_id, token):
    """Force Cloudflare to re-assert DNSSEC as active, which triggers a
    fresh signing pass and issues new RRSIG records with a new expiration.
    """
    import requests

    if DRY_RUN:
        log.info("[dry run] would PATCH DNSSEC status to active for zone %s", zone_id)
        return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{CF_API}/zones/{zone_id}/dnssec"
    requests.patch(url, headers=headers, json={"status": "active"}, timeout=30).raise_for_status()
    log.info("Triggered a re-sign for zone %s", zone_id)


def run():
    expiration = query_rrsig_expiration(DNS_DOMAIN, RECORD_TYPE)
    now = datetime.now(timezone.utc)
    state = check_rrsig_expiration(expiration, now, WARN_HOURS)

    if state == "ok":
        log.info("RRSIG for %s %s is valid until %s.", DNS_DOMAIN, RECORD_TYPE, expiration.isoformat())
        return

    log.warning(
        "RRSIG for %s %s is %s (expiration %s, now %s).",
        DNS_DOMAIN, RECORD_TYPE, state, expiration.isoformat(), now.isoformat(),
    )

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning(
            "No Cloudflare credentials set. If this zone uses a self-hosted "
            "or offline signer, re-sign it manually and reload the zone."
        )
        return

    status = get_cloudflare_dnssec_status(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)
    log.info("Current Cloudflare DNSSEC status: %s", status.get("status"))
    trigger_resign(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)


if __name__ == "__main__":
    run()
