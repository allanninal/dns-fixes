"""Detect a proxied Cloudflare record whose intended config expects a
custom TTL, which Cloudflare will always silently coerce to 1
(Automatic), and optionally repair the zone by either accepting
ttl: 1 in policy, or unproxying the record to keep a custom TTL.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
  REPAIR_POLICY            "accept_automatic" or "unproxy", default "accept_automatic"
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("proxied_record_forces_ttl")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def diagnose_ttl_proxy_mismatch(intended, live):
    """Pure decision function. No I/O.

    intended, live: {"ttl": int, "proxied": bool}

    Returns a mismatch reason string, or None if consistent.
      - If live.proxied is True and live.ttl != 1: impossible/stale-cache state.
      - If intended.proxied is True and intended.ttl not in (1, None):
        config is invalid per Cloudflare rules (would be silently coerced to 1).
      - If intended.proxied != live.proxied: proxy status itself drifted.
      - If intended.proxied is False and intended.ttl != live.ttl:
        real TTL drift, not the proxied-TTL quirk.
    """
    if live.get("proxied") is True and live.get("ttl") != 1:
        return "impossible state: live record is proxied but ttl is not 1 (stale read or cache)"

    if intended.get("proxied") is True and intended.get("ttl") not in (1, None):
        return "invalid config: proxied records are always coerced to ttl 1 by Cloudflare"

    if intended.get("proxied") != live.get("proxied"):
        return "proxy status drifted between intended config and live zone"

    if intended.get("proxied") is False and intended.get("ttl") != live.get("ttl"):
        return "real ttl drift on an unproxied record, not the proxied-ttl quirk"

    return None


def fetch_live_records(domain):
    """Return the live A/AAAA/CNAME records for domain from Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"name": domain, "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]


def repair_record(record_id, domain, record_type, content, policy, desired_ttl=300):
    """Repair a mismatched record.

    policy: "accept_automatic" sets ttl to 1 and keeps proxied true.
            "unproxy" sets proxied to false and keeps desired_ttl.
    """
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    if policy == "accept_automatic":
        body = {"type": record_type, "name": domain, "content": content, "proxied": True, "ttl": 1}
    elif policy == "unproxy":
        body = {"type": record_type, "name": domain, "content": content, "proxied": False, "ttl": desired_ttl}
    else:
        raise ValueError(f"unknown policy: {policy}")

    if DRY_RUN:
        log.info("[dry run] would PATCH record %s with %s", record_id, body)
        return

    r = requests.patch(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Repaired record %s with policy %s", record_id, policy)


def run(intended_by_name=None, policy=None):
    """intended_by_name: dict mapping record name -> {"ttl": int, "proxied": bool}."""
    if intended_by_name is None:
        intended_by_name = {f"app.{DNS_DOMAIN}": {"ttl": 300, "proxied": True}}
    if policy is None:
        policy = os.environ.get("REPAIR_POLICY", "accept_automatic")

    live_records = fetch_live_records(DNS_DOMAIN)
    mismatches = 0

    for rec in live_records:
        intended = intended_by_name.get(rec["name"])
        if intended is None:
            continue

        live = {"ttl": rec["ttl"], "proxied": rec["proxied"]}
        reason = diagnose_ttl_proxy_mismatch(intended, live)
        if reason is None:
            log.info("%s: consistent (ttl=%s, proxied=%s)", rec["name"], live["ttl"], live["proxied"])
            continue

        mismatches += 1
        log.warning("%s: %s", rec["name"], reason)

        if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
            log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
            continue

        repair_record(
            rec["id"], rec["name"], rec["type"], rec["content"],
            policy=policy, desired_ttl=intended.get("ttl") or 300,
        )

    log.info("Done. %d mismatch(es) found.", mismatches)


if __name__ == "__main__":
    run()
