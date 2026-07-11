"""Detect a missing A/AAAA record (true NXDOMAIN) and repair it via Cloudflare.

NXDOMAIN with an empty answer means the hostname has no record at all in the
zone, not an A record, not an AAAA record, not even a CNAME. That is different
from NOERROR with an empty answer (NODATA), which means the name exists but
not for the record type queried. See RFC 8020.

Safe to run on a schedule. Stays in dry run until DRY_RUN=false.

Environment:
    DNS_DOMAIN             the hostname to check, e.g. app.example.com
    RECORD_TYPE             "A" or "AAAA" (default "A")
    RECORD_TARGET           the IP address to point the record at
    RECORD_TTL              TTL in seconds (default 300)
    CLOUDFLARE_API_TOKEN    Cloudflare API token (only needed for the repair)
    CLOUDFLARE_ZONE_ID      Cloudflare zone id (only needed for the repair)
    DRY_RUN                 "true" (default) reports only, "false" writes
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("missing_address_record")


def classify_missing_record(rcode: str, answer_count: int, expected_name_exists: bool) -> str:
    """Pure decision function. No network, no I/O.

    rcode: the DNS response rcode string, e.g. "NXDOMAIN" or "NOERROR".
    answer_count: number of records in the answer section.
    expected_name_exists: whether this name is expected to be provisioned.

    Returns one of:
      "missing_record_nxdomain" - rcode is NXDOMAIN, no answers, and the name
                                   was expected to be live.
      "nodata_wrong_type"       - rcode is NOERROR but no answers (name exists,
                                   just not for this record type).
      "ok"                      - there is at least one answer.
      "unexpected"              - anything else (e.g. NXDOMAIN on a name that
                                   was never expected to exist).
    """
    if rcode == "NXDOMAIN" and answer_count == 0 and expected_name_exists:
        return "missing_record_nxdomain"
    if rcode == "NOERROR" and answer_count == 0:
        return "nodata_wrong_type"
    if answer_count > 0:
        return "ok"
    return "unexpected"


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    record_type = os.environ.get("RECORD_TYPE", "A")
    target = os.environ.get("RECORD_TARGET", "203.0.113.10")
    ttl = int(os.environ.get("RECORD_TTL", "300"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    # Find the authoritative nameservers for the zone, then query them
    # directly so the answer cannot be a stale cache.
    ns_answer = dns.resolver.resolve(domain, "NS")
    nameservers = [str(r.target).rstrip(".") for r in ns_answer]
    ns_ip = dns.resolver.resolve(nameservers[0], "A")[0].address

    resolver = dns.resolver.Resolver()
    resolver.nameservers = [ns_ip]

    try:
        answer = resolver.resolve(domain, record_type)
        rcode = "NOERROR"
        answer_count = len(answer)
    except dns.resolver.NXDOMAIN:
        rcode = "NXDOMAIN"
        answer_count = 0
    except dns.resolver.NoAnswer:
        rcode = "NOERROR"
        answer_count = 0

    outcome = classify_missing_record(rcode, answer_count, expected_name_exists=True)
    log.info("Name %s classified as %s (rcode=%s, answers=%d)", domain, outcome, rcode, answer_count)

    if outcome != "missing_record_nxdomain":
        log.info("Nothing to repair.")
        return

    log.info("Missing %s record for %s. %s create it pointing to %s.",
              record_type, domain, "Would" if dry_run else "Will", target)

    if dry_run:
        return

    resp = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        json={"type": record_type, "name": domain, "content": target, "ttl": ttl},
        timeout=30,
    )
    resp.raise_for_status()
    log.info("Created %s record for %s -> %s", record_type, domain, target)


if __name__ == "__main__":
    run()
