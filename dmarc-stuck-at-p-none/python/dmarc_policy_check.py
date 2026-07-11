"""Detect a DMARC record stuck at p=none and repair it via Cloudflare.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dmarc_policy_check")


def parse_dmarc_tags(record_value: str) -> dict:
    """Pure parser. No network, no I/O.

    Turns 'v=DMARC1; p=none; rua=mailto:a@b.com; pct=100' into a dict
    of tag to value.
    """
    tags = {}
    for part in record_value.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        tags[key.strip()] = value.strip()
    return tags


def next_dmarc_policy(record_value: str, days_since_last_change: int, spf_dkim_aligned_pct: float):
    """Pure decision function. No network, no I/O.

    Returns the next DMARC record string to publish, or None if no
    change is warranted yet.
    """
    tags = parse_dmarc_tags(record_value)

    if tags.get("p") != "none":
        return None
    if days_since_last_change < 90:
        return None
    if spf_dkim_aligned_pct < 0.98:
        return None

    tags["p"] = "quarantine"
    tags["pct"] = "25"
    order = ["v", "p", "pct", "rua", "ruf", "adkim", "aspf"]
    ordered_keys = [k for k in order if k in tags] + [k for k in tags if k not in order]
    return "; ".join(f"{k}={tags[k]}" for k in ordered_keys)


def run():
    # Imported lazily so the pure functions above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    days_since_last_change = int(os.environ.get("DAYS_SINCE_LAST_CHANGE", "0"))
    spf_dkim_aligned_pct = float(os.environ.get("SPF_DKIM_ALIGNED_PCT", "0"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    name = f"_dmarc.{domain}"
    resolver = dns.resolver.Resolver()
    try:
        answer = resolver.resolve(name, "TXT")
        records = ["".join(part.decode() if isinstance(part, bytes) else part for part in rdata.strings)
                   for rdata in answer]
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        records = []

    if not records:
        log.warning("No DMARC record found at %s", name)
        return

    current = records[0]
    tags = parse_dmarc_tags(current)
    log.info("Current record at %s: %s", name, current)

    if tags.get("p") != "none":
        log.info("Policy is already %s, nothing to do.", tags.get("p"))
        return

    proposed = next_dmarc_policy(current, days_since_last_change, spf_dkim_aligned_pct)
    if proposed is None:
        log.info(
            "Policy is p=none but it is not safe to advance yet "
            "(days_since_last_change=%s, spf_dkim_aligned_pct=%s).",
            days_since_last_change, spf_dkim_aligned_pct,
        )
        return

    log.info("%s update %s to: %s", "Would" if dry_run else "Will", name, proposed)
    if dry_run:
        return

    lookup = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers={"Authorization": f"Bearer {api_token}"},
        params={"type": "TXT", "name": name},
        timeout=30,
    )
    lookup.raise_for_status()
    existing = lookup.json().get("result", [])
    if not existing:
        log.warning("No existing TXT record found to patch for %s", name)
        return

    record_id = existing[0]["id"]
    resp = requests.patch(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        json={"type": "TXT", "name": name, "content": proposed},
        timeout=30,
    )
    resp.raise_for_status()
    log.info("Raised DMARC policy for %s", name)


if __name__ == "__main__":
    run()
