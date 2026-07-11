"""Detect a missing subdomain delegation and repair it in the parent zone.

DETECT: query the parent zone's own authoritative nameserver for the NS
record set at the subdomain name, and query the child zone's own
authoritative nameserver for its NS and SOA records.

REPAIR: if the child is live but the parent has no matching NS records,
add the missing NS records in the parent zone through the Cloudflare API.

Safe to run again and again. Starts in dry run mode.

Environment:
  DNS_DOMAIN               the subdomain to check, e.g. "app.example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for the repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id for the PARENT zone
  DRY_RUN                  "true" (default) reports only, "false" writes
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_delegation")


def is_delegation_missing(parent_ns_answer, child_ns_answer, child_soa_present):
    """
    parent_ns_answer: NS hostnames returned by the parent zone's authoritative
                       server when queried for the subdomain name (empty list
                       if NXDOMAIN/no data).
    child_ns_answer:  NS hostnames returned by the child zone's own
                       authoritative server for the same name.
    child_soa_present: True if the child zone answers with a valid SOA record
                        for the subdomain (i.e. the child zone is actually
                        configured and live).
    Returns True (delegation is missing/broken) when the child zone is
    live and has NS records, but the parent has no NS records for that
    name, or the parent's NS set shares no hostnames with the child's.
    """
    if not child_soa_present or not child_ns_answer:
        return False  # child isn't configured; not a delegation problem
    if not parent_ns_answer:
        return True   # parent has nothing delegating this name
    return len(set(parent_ns_answer) & set(child_ns_answer)) == 0


def _parent_zone_of(name):
    parts = name.rstrip(".").split(".")
    return ".".join(parts[1:])


def _query_ns(name, nameserver=None):
    """Query NS records for name. If nameserver is given, ask it directly."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    if nameserver:
        resolver.nameservers = [nameserver]
    try:
        answer = resolver.resolve(name, "NS")
        return sorted(str(r.target).rstrip(".") for r in answer)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers):
        return []


def _query_soa_present(name, nameserver=None):
    import dns.resolver

    resolver = dns.resolver.Resolver()
    if nameserver:
        resolver.nameservers = [nameserver]
    try:
        resolver.resolve(name, "SOA")
        return True
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers):
        return False


def _find_authoritative_ns(zone):
    import dns.resolver

    answer = dns.resolver.resolve(zone, "NS")
    return sorted(str(r.target).rstrip(".") for r in answer)


def _add_delegation_records(subdomain, child_nameservers, api_token, zone_id, dry_run):
    """Add one NS record per child nameserver in the parent zone via Cloudflare."""
    import requests

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    for ns_host in child_nameservers:
        payload = {"type": "NS", "name": subdomain, "content": ns_host}
        if dry_run:
            log.info("DRY RUN: would create NS record %s -> %s", subdomain, ns_host)
            continue
        r = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            json=payload, headers=headers, timeout=30,
        )
        r.raise_for_status()
        log.info("Created NS record %s -> %s", subdomain, ns_host)


def run():
    subdomain = os.environ["DNS_DOMAIN"]
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID", "")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    parent_zone = _parent_zone_of(subdomain)

    parent_authoritative = _find_authoritative_ns(parent_zone)
    parent_ns_answer = []
    if parent_authoritative:
        parent_ns_answer = _query_ns(subdomain, nameserver=parent_authoritative[0])

    child_ns_answer = _query_ns(subdomain)
    child_soa_present = _query_soa_present(subdomain)

    if is_delegation_missing(parent_ns_answer, child_ns_answer, child_soa_present):
        log.warning(
            "Missing delegation for %s: parent has %s, child has %s",
            subdomain, parent_ns_answer, child_ns_answer,
        )
        if not api_token or not zone_id:
            log.info("No Cloudflare credentials set. Skipping repair, reporting only.")
            return
        _add_delegation_records(subdomain, child_ns_answer, api_token, zone_id, dry_run)
    else:
        log.info("Delegation looks fine for %s.", subdomain)


if __name__ == "__main__":
    run()
