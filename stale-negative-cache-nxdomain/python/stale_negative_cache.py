"""Detect a stale negative-cache NXDOMAIN across public resolvers.
Safe to run on a schedule. Only reads, unless you also lower the zone's
negative-cache TTL, which is guarded by DRY_RUN.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stale_negative_cache")


def stale_negative_cache_report(soa_minimum: int, soa_ttl_seen: int,
                                 resolver_results: dict, authoritative_has_record: bool) -> dict:
    """
    Pure decision logic, no I/O.
    - soa_minimum: the SOA MINIMUM field (negative-cache TTL) in seconds, from RFC 2308.
    - soa_ttl_seen: the TTL value seen on the SOA record inside an NXDOMAIN authority section
      (countdown remaining).
    - resolver_results: {resolver_ip: (rcode, sample_ttl)} e.g.
      {"8.8.8.8": ("NXDOMAIN", 2143), "1.1.1.1": ("NOERROR", 299)}.
    - authoritative_has_record: True if the authoritative server currently answers NOERROR
      for the name.
    Returns: {"stale_resolvers": [...], "eta_seconds": {...}, "is_stale_negative_cache": bool}
    """
    stale = []
    eta = {}
    for resolver, (rcode, ttl) in resolver_results.items():
        if authoritative_has_record and rcode == "NXDOMAIN":
            stale.append(resolver)
            eta[resolver] = max(ttl, 0)  # seconds remaining until this resolver's entry expires
    return {
        "stale_resolvers": stale,
        "eta_seconds": eta,
        "is_stale_negative_cache": authoritative_has_record and len(stale) > 0,
        "max_wait_seconds": max(eta.values()) if eta else 0,
    }


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import dns.rdatatype
    import requests

    domain = os.environ["DNS_DOMAIN"]
    zone = os.environ.get("DNS_ZONE", domain)
    public_resolvers = os.environ.get("PUBLIC_RESOLVERS", "1.1.1.1,8.8.8.8,9.9.9.9").split(",")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    # Confirm the record at the authoritative server first, bypassing recursion.
    ns_answer = dns.resolver.resolve(zone, "NS")
    nameservers = [str(r.target).rstrip(".") for r in ns_answer]
    ns_ip = dns.resolver.resolve(nameservers[0], "A")[0].address

    auth_resolver = dns.resolver.Resolver()
    auth_resolver.nameservers = [ns_ip]

    authoritative_has_record = True
    try:
        auth_resolver.resolve(domain, "A")
    except dns.resolver.NXDOMAIN:
        authoritative_has_record = False
    except dns.resolver.NoAnswer:
        authoritative_has_record = False

    # Read the zone's SOA MINIMUM (negative-cache TTL, per RFC 2308).
    soa = dns.resolver.resolve(zone, "SOA")[0]
    soa_minimum = soa.minimum

    # Query each public resolver directly and record rcode plus the SOA TTL
    # it shows in the authority section, if any.
    resolver_results = {}
    for ip in public_resolvers:
        r = dns.resolver.Resolver()
        r.nameservers = [ip.strip()]
        try:
            r.resolve(domain, "A")
            resolver_results[ip.strip()] = ("NOERROR", 0)
        except dns.resolver.NXDOMAIN as exc:
            ttl = 0
            response = exc.response() if hasattr(exc, "response") else None
            for rrset in (response.authority if response else []):
                if rrset.rdtype == dns.rdatatype.SOA:
                    ttl = rrset.ttl
            resolver_results[ip.strip()] = ("NXDOMAIN", ttl)
        except dns.resolver.NoAnswer:
            resolver_results[ip.strip()] = ("NOERROR", 0)

    report = stale_negative_cache_report(soa_minimum, 0, resolver_results, authoritative_has_record)
    log.info("Report for %s: %s", domain, report)

    if not report["is_stale_negative_cache"]:
        log.info("No stale negative cache detected.")
        return

    log.info("Stale on %s. Longest wait about %d seconds.",
              ", ".join(report["stale_resolvers"]), report["max_wait_seconds"])

    if not zone_id or not api_token:
        log.info("No Cloudflare credentials set, skipping negative-cache TTL check.")
        return

    settings = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_settings",
        headers={"Authorization": f"Bearer {api_token}"},
        timeout=30,
    )
    settings.raise_for_status()
    log.info("Current zone DNS settings: %s", settings.json().get("result"))

    if dry_run:
        log.info("Dry run: would lower the zone's negative-cache TTL to speed up future recovery.")
        return

    resp = requests.patch(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_settings",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        json={"ns_ttl": 300},
        timeout=30,
    )
    resp.raise_for_status()
    log.info("Lowered the zone's negative-cache TTL to 300 seconds for next time.")


if __name__ == "__main__":
    run()
