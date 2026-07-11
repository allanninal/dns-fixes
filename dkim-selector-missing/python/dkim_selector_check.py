"""Detect a missing or stale DKIM selector record and repair it via Cloudflare.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dkim_selector_check")

DEFAULT_SELECTORS = ["google", "selector1", "selector2", "k1", "s1"]


def evaluate_dkim_selector(txt_answers: list, expected_selector: str, expected_pubkey_fragment: str = None) -> dict:
    """Pure decision function. No network, no I/O.

    txt_answers is the list of TXT strings already resolved for
    selector._domainkey.domain (empty list if NXDOMAIN or no answer).
    """
    if not txt_answers:
        return {"status": "missing", "reason": f"no TXT record found for selector '{expected_selector}'"}

    value = txt_answers[0]
    if not value.startswith("v=DKIM1"):
        return {"status": "stale", "reason": "record exists but does not start with v=DKIM1"}

    if expected_pubkey_fragment and expected_pubkey_fragment not in value:
        return {"status": "stale", "reason": "record exists but public key does not match the expected key"}

    return {"status": "ok", "reason": "record is present and matches expectations"}


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    selectors = [s.strip() for s in os.environ.get("DKIM_SELECTORS", ",".join(DEFAULT_SELECTORS)).split(",") if s.strip()]
    expected_pubkey_fragment = os.environ.get("DKIM_PUBKEY_FRAGMENT") or None
    new_record_value = os.environ.get("DKIM_RECORD_VALUE")
    ttl = int(os.environ.get("RECORD_TTL", "3600"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    resolvers = {"8.8.8.8": dns.resolver.Resolver(), "1.1.1.1": dns.resolver.Resolver()}
    for ip, resolver in resolvers.items():
        resolver.nameservers = [ip]

    for selector in selectors:
        name = f"{selector}._domainkey.{domain}"
        results = {}
        for ip, resolver in resolvers.items():
            try:
                answer = resolver.resolve(name, "TXT")
                results[ip] = ["".join(r.strings[0].decode() if isinstance(r.strings[0], bytes) else r.strings[0]
                                       for r in [rdata]) for rdata in answer]
            except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                results[ip] = []

        txt_answers = results.get("8.8.8.8", [])
        outcome = evaluate_dkim_selector(txt_answers, selector, expected_pubkey_fragment)
        log.info("Selector %s (%s): %s -> %s", selector, name, outcome["status"], outcome["reason"])

        if results.get("8.8.8.8") != results.get("1.1.1.1"):
            log.warning("Selector %s disagrees between resolvers, likely propagation in progress", selector)

        if outcome["status"] == "ok":
            continue
        if not new_record_value:
            log.info("No DKIM_RECORD_VALUE set, skipping repair for %s.", selector)
            continue

        log.info("%s create/update TXT record for %s.", "Would" if dry_run else "Will", name)
        if dry_run:
            continue

        lookup = requests.get(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers={"Authorization": f"Bearer {api_token}"},
            params={"type": "TXT", "name": name},
            timeout=30,
        )
        lookup.raise_for_status()
        existing = lookup.json().get("result", [])

        payload = {"type": "TXT", "name": name, "content": new_record_value, "ttl": ttl}
        if existing:
            record_id = existing[0]["id"]
            resp = requests.put(
                f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}",
                headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
                json=payload, timeout=30,
            )
        else:
            resp = requests.post(
                f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
                headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
                json=payload, timeout=30,
            )
        resp.raise_for_status()
        log.info("Published DKIM TXT record for %s", name)


if __name__ == "__main__":
    run()
