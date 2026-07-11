"""Detect a mismatch between the registrar's delegated nameservers and the
nameservers the zone actually answers with. Diagnostic only: the registrar
side cannot be fixed through the Cloudflare DNS API, so this script never
writes anything, it only reports what it finds.

Environment:
  DNS_DOMAIN              domain to check (default: example.com)
  CLOUDFLARE_API_TOKEN    accepted for consistency with the other fixes
                          in this repo, unused (see note in run())
  CLOUDFLARE_ZONE_ID      accepted for consistency with the other fixes
                          in this repo, unused (see note in run())
  DRY_RUN                 default "true"; this script never writes
                          regardless of this flag
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_ns_mismatch")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"


def normalize_ns(hostname):
    """Lowercase and strip a trailing dot so hostnames compare cleanly."""
    return hostname.strip().lower().rstrip(".")


def ns_sets_match(registrar_ns, zone_ns):
    """Pure function, no I/O. Normalize each hostname (lowercase, strip the
    trailing dot) and compare the two lists as sets. Order, case, and a
    trailing dot never matter; a missing or extra server always does.
    """
    return {normalize_ns(h) for h in registrar_ns} == {normalize_ns(h) for h in zone_ns}


def get_registrar_ns(domain):
    """RDAP is the registry-facing view: what the registrar has delegated."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=15)
    r.raise_for_status()
    data = r.json()
    return [ns["ldhName"] for ns in data.get("nameservers", []) if ns.get("ldhName")]


def get_zone_ns(domain):
    """dnspython gives the live, authoritative-side view of the zone's NS set."""
    import dns.resolver

    answer = dns.resolver.resolve(domain, "NS")
    return [str(rdata.target) for rdata in answer]


def run():
    log.info("Checking nameserver delegation for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    registrar_ns = get_registrar_ns(DNS_DOMAIN)
    zone_ns = get_zone_ns(DNS_DOMAIN)

    log.info("Registrar (RDAP) nameservers: %s", sorted(registrar_ns))
    log.info("Zone (live NS query) nameservers: %s", sorted(zone_ns))

    if ns_sets_match(registrar_ns, zone_ns):
        log.info("OK: registrar delegation matches the live zone. Nothing to do.")
        return

    log.warning(
        "MISMATCH: the registrar delegates to %s but the zone answers with %s. "
        "This is a registrar-side fix, not something the Cloudflare DNS API can change. "
        "Update the nameserver list at the registrar to match the zone's NS set.",
        sorted(registrar_ns), sorted(zone_ns),
    )

    # Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
    # accepted for consistency with the other fixes in this repo, and would be
    # used to manage records inside a zone already delegated to Cloudflare via
    # https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but
    # that endpoint has no way to touch the registrar's delegation itself, so
    # this script never calls it.
    if not DRY_RUN:
        log.info("DRY_RUN is false, but this check never writes. Fix the registrar by hand.")


if __name__ == "__main__":
    run()
