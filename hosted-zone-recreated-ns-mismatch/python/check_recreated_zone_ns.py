"""Detect a mismatch between a recreated hosted zone's live nameservers and
the nameservers the registrar still has delegated. Diagnostic only: fixing
the registrar's delegation is a registrar-portal action, not something the
Cloudflare DNS API can do, so this script never writes anything.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_recreated_zone_ns")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"


def normalize_ns(hostname):
    return hostname.strip().lower().rstrip(".")


def ns_sets_match(zone_ns, registrar_ns):
    """Pure function, no I/O. Normalize each hostname (strip the trailing
    dot, lowercase), convert both lists to sets, and compare them. True
    means the delegation matches. False means the registrar is stale."""
    return {normalize_ns(h) for h in zone_ns} == {normalize_ns(h) for h in registrar_ns}


def get_zone_ns(zone_id):
    """The provider's own view: the live nameservers the recreated zone was
    actually assigned. Uses the Cloudflare API here; Route 53 users can swap
    in aws route53 get-hosted-zone instead."""
    import requests

    url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}"
    r = requests.get(url, headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=15)
    r.raise_for_status()
    return r.json()["result"]["name_servers"]


def get_registrar_ns(domain):
    """RDAP is the registry-facing view: what the registrar has delegated."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=15)
    r.raise_for_status()
    data = r.json()
    return [ns["ldhName"] for ns in data.get("nameservers", []) if ns.get("ldhName")]


def run():
    log.info("Checking nameserver delegation for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    zone_ns = get_zone_ns(CLOUDFLARE_ZONE_ID)
    registrar_ns = get_registrar_ns(DNS_DOMAIN)

    log.info("Zone (provider API) nameservers: %s", sorted(zone_ns))
    log.info("Registrar (RDAP) nameservers: %s", sorted(registrar_ns))

    if ns_sets_match(zone_ns, registrar_ns):
        log.info("OK: registrar delegation matches the recreated zone. Nothing to do.")
        return

    log.warning(
        "MISMATCH: the zone now answers with %s but the registrar still delegates to %s. "
        "This looks like a hosted zone that was deleted and recreated without updating the "
        "registrar. Update the nameserver list at the registrar to the zone's current values.",
        sorted(zone_ns), sorted(registrar_ns),
    )

    # Note for future readers: fixing this is a registrar-portal action. The
    # Cloudflare DNS API at https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records
    # only manages records inside a zone already delegated to it, it has no
    # endpoint that can touch what the registrar publishes to the registry.
    if not DRY_RUN:
        log.info("DRY_RUN is false, but this check never writes. Fix the registrar by hand.")


if __name__ == "__main__":
    run()
