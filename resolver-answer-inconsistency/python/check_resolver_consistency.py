"""Detect whether public resolvers disagree with a zone's authoritative
answer because of ordinary TTL caching, or because of a real mismatch at
the DNS host. On repair, lowers the record's TTL through the Cloudflare
API so future changes converge faster. Safe to run again and again.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_resolver_consistency")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
RECORD_TYPE = os.environ.get("RECORD_TYPE", "A")
PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222"]
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"


def diagnose_resolver_inconsistency(authoritative_answer, resolver_answers, resolver_ttls, configured_ttl):
    """Pure decision logic, no I/O.

    authoritative_answer: set of record values from the zone's own
    authoritative NS (source of truth).
    resolver_answers: {resolver_ip: set of record values returned}.
    resolver_ttls: {resolver_ip: TTL currently reported for that answer}.
    configured_ttl: the TTL currently set on the authoritative record.

    Returns a dict:
    {
      "consistent": bool,
      "stale_resolvers": list[str],
      "likely_cause": "propagation_lag" | "authoritative_mismatch" | "none",
      "recommend_lower_ttl": bool,
    }

    A resolver is "stale" if its answer set differs from authoritative_answer.
    If authoritative_answer itself is not unanimous in resolver_answers.values()
    across resolvers that DO match it, and configured_ttl is high (over 3600
    seconds), the cause is "propagation_lag" and recommend_lower_ttl is True.
    If even resolvers with expired-looking TTLs (close to 0) still disagree
    with authoritative_answer, or all resolvers agree with each other but
    differ from authoritative_answer, the cause is "authoritative_mismatch"
    (a partial rollout at the DNS host) and recommend_lower_ttl is False.
    """
    stale = [ip for ip, answer in resolver_answers.items() if answer != authoritative_answer]

    if not stale:
        return {
            "consistent": True,
            "stale_resolvers": [],
            "likely_cause": "none",
            "recommend_lower_ttl": False,
        }

    matching = [ip for ip in resolver_answers if ip not in stale]

    near_expired_but_still_stale = any(resolver_ttls.get(ip, configured_ttl) <= 5 for ip in stale)
    all_stale_agree_with_each_other = len({tuple(sorted(resolver_answers[ip])) for ip in stale}) == 1
    no_resolver_matches_authoritative = not matching

    if near_expired_but_still_stale or (all_stale_agree_with_each_other and no_resolver_matches_authoritative):
        return {
            "consistent": False,
            "stale_resolvers": stale,
            "likely_cause": "authoritative_mismatch",
            "recommend_lower_ttl": False,
        }

    return {
        "consistent": False,
        "stale_resolvers": stale,
        "likely_cause": "propagation_lag",
        "recommend_lower_ttl": configured_ttl > 3600,
    }


def query_resolver(name, rdtype, resolver_ip):
    """One resolver's answer set and the TTL it currently reports."""
    import dns.resolver

    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [resolver_ip]
    r.lifetime = 5
    answer = r.resolve(name, rdtype)
    values = {rdata.to_text() for rdata in answer}
    ttl = answer.rrset.ttl
    return values, ttl


def query_authoritative(name, rdtype, domain):
    """Ask the zone's own authoritative nameservers directly, bypassing
    every public resolver's cache."""
    import dns.resolver

    ns_answer = dns.resolver.resolve(domain, "NS")
    ns_host = str(ns_answer[0].target).rstrip(".")
    ns_ip = dns.resolver.resolve(ns_host, "A")[0].to_text()

    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [ns_ip]
    r.lifetime = 5
    answer = r.resolve(name, rdtype)
    values = {rdata.to_text() for rdata in answer}
    ttl = answer.rrset.ttl
    return values, ttl


def lower_ttl(record_id, name, rdtype, content, new_ttl=300):
    """Repair step: lower the record's TTL through the Cloudflare API so
    future changes converge faster. Only called when the cause is a stale
    long TTL, never for an authoritative mismatch."""
    import requests

    url = f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    payload = {"type": rdtype, "name": name, "content": content, "ttl": new_ttl}
    resp = requests.patch(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def find_record_id(name, rdtype):
    import requests

    url = f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    resp = requests.get(url, headers=headers, params={"type": rdtype, "name": name}, timeout=30)
    resp.raise_for_status()
    results = resp.json()["result"]
    return results[0] if results else None


def run():
    log.info("Checking resolver consistency for %s %s (DRY_RUN=%s)", DNS_DOMAIN, RECORD_TYPE, DRY_RUN)

    authoritative_answer, configured_ttl = query_authoritative(DNS_DOMAIN, RECORD_TYPE, DNS_DOMAIN)
    log.info("Authoritative answer: %s (TTL %s)", sorted(authoritative_answer), configured_ttl)

    resolver_answers = {}
    resolver_ttls = {}
    for ip in PUBLIC_RESOLVERS:
        try:
            values, ttl = query_resolver(DNS_DOMAIN, RECORD_TYPE, ip)
            resolver_answers[ip] = values
            resolver_ttls[ip] = ttl
            log.info("Resolver %s: %s (TTL %s)", ip, sorted(values), ttl)
        except Exception as exc:
            log.warning("Resolver %s failed to answer: %s", ip, exc)

    result = diagnose_resolver_inconsistency(authoritative_answer, resolver_answers, resolver_ttls, configured_ttl)
    log.info("Diagnosis: %s", result)

    if result["consistent"]:
        log.info("OK: every resolver agrees with the authoritative answer. Nothing to do.")
        return

    if result["likely_cause"] == "authoritative_mismatch":
        log.warning(
            "Authoritative mismatch detected, this is not ordinary propagation. "
            "Fix the record at the DNS host so every authoritative server agrees."
        )
        return

    log.warning(
        "Ordinary propagation lag. Stale resolvers: %s. This will clear on its own within "
        "the current TTL window (%s seconds).", result["stale_resolvers"], configured_ttl,
    )

    if result["recommend_lower_ttl"]:
        record = find_record_id(DNS_DOMAIN, RECORD_TYPE)
        if not record:
            log.warning("Could not find the record via the Cloudflare API to lower its TTL.")
            return
        if DRY_RUN:
            log.info("Dry run: would lower TTL for record %s from %s to 300", record["id"], configured_ttl)
            return
        lower_ttl(record["id"], DNS_DOMAIN, RECORD_TYPE, record["content"], new_ttl=300)
        log.info("Lowered TTL for %s to 300 seconds so future changes converge faster.", DNS_DOMAIN)


if __name__ == "__main__":
    run()
