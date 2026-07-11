"""Detect a TTL that is too low for a record's real traffic and, on
repair, raise it back to a safe value through the Cloudflare API.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ttl_too_low")

TTL_LADDER = (60, 120, 300, 900, 3600, 86400)


def assess_ttl_risk(ttl_seconds, daily_unique_resolvers, qps_risk_threshold=5.0, min_safe_ttl=300):
    """Pure decision function. No DNS I/O, no network calls.

    ttl_seconds: the record's current TTL, in seconds, as read from a
        live answer (dnspython) or the provider API.
    daily_unique_resolvers: a known or estimated count of unique
        resolvers/clients hitting the domain per day.
    qps_risk_threshold: flag the record once estimated authoritative
        queries per second crosses this value.
    min_safe_ttl: flag the record if its TTL is below this floor,
        regardless of estimated QPS (a 30 second TTL is a red flag
        even on a quiet domain).

    Returns {"risky": bool, "estimated_qps": float, "recommended_ttl": int}.
    """
    safe_ttl = max(ttl_seconds, 1)
    estimated_qps = daily_unique_resolvers / safe_ttl

    risky = estimated_qps > qps_risk_threshold or ttl_seconds < min_safe_ttl

    recommended_ttl = safe_ttl
    for candidate in TTL_LADDER:
        if daily_unique_resolvers / candidate <= qps_risk_threshold and candidate >= min_safe_ttl:
            recommended_ttl = candidate
            break
    else:
        recommended_ttl = TTL_LADDER[-1]

    return {
        "risky": risky,
        "estimated_qps": estimated_qps,
        "recommended_ttl": recommended_ttl,
    }


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    daily_unique_resolvers = int(os.environ.get("DAILY_UNIQUE_RESOLVERS", "50000"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    resolver = dns.resolver.Resolver()
    answer = resolver.resolve(domain, "A")
    current_ttl = answer.rrset.ttl
    log.info("Live TTL for %s A record: %d seconds", domain, current_ttl)

    result = assess_ttl_risk(current_ttl, daily_unique_resolvers)
    log.info(
        "Estimated QPS: %.4f, risky: %s, recommended TTL: %d",
        result["estimated_qps"], result["risky"], result["recommended_ttl"],
    )

    if not result["risky"]:
        log.info("No fix needed. TTL is within a safe range for this traffic level.")
        return

    if dry_run:
        log.info(
            "Dry run: would raise TTL for %s from %d to %d seconds",
            domain, current_ttl, result["recommended_ttl"],
        )
        return

    list_resp = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        params={"type": "A", "name": domain},
        timeout=30,
    )
    list_resp.raise_for_status()
    records = list_resp.json().get("result", [])
    record_id = next((r["id"] for r in records), None)
    if record_id is None:
        log.warning("No existing A record id found to update at %s", domain)
        return

    patch_resp = requests.patch(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}",
        headers=headers,
        json={"ttl": result["recommended_ttl"]},
        timeout=30,
    )
    patch_resp.raise_for_status()
    log.info("Raised TTL for %s to %d seconds", domain, result["recommended_ttl"])


if __name__ == "__main__":
    run()
