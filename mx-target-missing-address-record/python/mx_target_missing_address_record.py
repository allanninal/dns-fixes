"""Detect an MX target with no A/AAAA record (a dangling MX) and repair it
via Cloudflare. Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mx_target_missing_address_record")


def find_dangling_mx_targets(mx_targets: list[str], resolved_addresses: dict[str, list[str]]) -> list[str]:
    """mx_targets: list of MX target hostnames (e.g. ['mail.example.com']).
    resolved_addresses: mapping of hostname -> list of A/AAAA IPs already looked up (empty list if none/NXDOMAIN).
    Returns the subset of mx_targets that have no A or AAAA address (dangling MX), preserving order, deduplicated."""
    seen = set()
    dangling = []
    for host in mx_targets:
        if host in seen:
            continue
        seen.add(host)
        if not resolved_addresses.get(host):
            dangling.append(host)
    return dangling


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import dns.exception
    import requests

    domain = os.environ["DNS_DOMAIN"]
    fallback_ip = os.environ.get("RECORD_TARGET", "203.0.113.25")
    ttl = int(os.environ.get("RECORD_TTL", "3600"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    mx_answer = dns.resolver.resolve(domain, "MX")
    mx_targets = [str(r.exchange).rstrip(".") for r in mx_answer]
    log.info("Found %d MX target(s) for %s: %s", len(mx_targets), domain, mx_targets)

    resolved_addresses = {}
    for host in mx_targets:
        addresses = []
        for rtype in ("A", "AAAA"):
            try:
                answer = dns.resolver.resolve(host, rtype)
                addresses.extend(str(r) for r in answer)
            except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                pass
        resolved_addresses[host] = addresses

    dangling = find_dangling_mx_targets(mx_targets, resolved_addresses)

    if not dangling:
        log.info("Every MX target for %s has an A or AAAA record. Nothing to repair.", domain)
        return

    for host in dangling:
        log.info("MX target %s has no A/AAAA record. %s create an A record pointing to %s.",
                  host, "Would" if dry_run else "Will", fallback_ip)

        if dry_run:
            continue

        resp = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
            json={"type": "A", "name": host, "content": fallback_ip, "ttl": ttl, "proxied": False},
            timeout=30,
        )
        resp.raise_for_status()
        log.info("Created A record for %s -> %s (DNS only)", host, fallback_ip)


if __name__ == "__main__":
    run()
