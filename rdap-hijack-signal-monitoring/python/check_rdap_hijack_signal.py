"""Poll RDAP for a domain and diff it against a stored known-good snapshot to
catch the early signal of a hijack: a lost transfer lock, a nameserver you did
not configure, or a registrant/registrar change. Detect only: re-locking the
domain, resetting registrar credentials, or halting a transfer are registrar
and EPP-level actions this script cannot perform through the Cloudflare DNS
API, so it never writes anything, it only reports what it finds.
"""
import os
import json
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_rdap_hijack_signal")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
SNAPSHOT_PATH = os.environ.get("SNAPSHOT_PATH", "rdap_snapshot.json")


def diff_rdap_snapshot(baseline, current):
    """Pure function, no I/O. baseline/current are shaped as:
    {"status": list[str], "nameservers": list[str], "registrant_handle": str,
     "registrar_handle": str, "last_changed": str}
    Returns a list of human-readable alert strings. An empty list means no
    hijack signal was detected.
    """
    alerts = []

    baseline_status = set(baseline.get("status", []))
    current_status = set(current.get("status", []))
    lost_locks = baseline_status - current_status
    for lock in sorted(lost_locks):
        alerts.append(f"status lost {lock}")

    baseline_ns = baseline.get("nameservers", [])
    current_ns = current.get("nameservers", [])
    if set(baseline_ns) != set(current_ns):
        alerts.append(f"nameservers changed: {baseline_ns} -> {current_ns}")

    if baseline.get("registrant_handle") != current.get("registrant_handle"):
        alerts.append("registrant_handle changed")

    if baseline.get("registrar_handle") != current.get("registrar_handle"):
        alerts.append("registrar_handle changed")

    if baseline.get("last_changed") != current.get("last_changed"):
        alerts.append(
            f"last_changed event moved: {baseline.get('last_changed')} -> {current.get('last_changed')}"
        )

    return alerts


def normalize_rdap(data):
    """Turn a raw RDAP JSON document into the flat shape diff_rdap_snapshot expects."""
    status = list(data.get("status", []))
    nameservers = sorted(
        ns["ldhName"] for ns in data.get("nameservers", []) if ns.get("ldhName")
    )

    registrant_handle = None
    registrar_handle = None
    for entity in data.get("entities", []):
        roles = entity.get("roles", [])
        if "registrant" in roles and registrant_handle is None:
            registrant_handle = entity.get("handle")
        if "registrar" in roles and registrar_handle is None:
            registrar_handle = entity.get("handle")

    last_changed = None
    for event in data.get("events", []):
        if event.get("eventAction") in ("last changed", "transfer"):
            last_changed = event.get("eventDate")

    return {
        "status": sorted(status),
        "nameservers": nameservers,
        "registrant_handle": registrant_handle,
        "registrar_handle": registrar_handle,
        "last_changed": last_changed,
    }


def fetch_rdap(domain):
    """RDAP over HTTP via ICANN's public bootstrap redirector (RFC 9082 / 9083)."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=15, allow_redirects=True)
    r.raise_for_status()
    return r.json()


def load_baseline(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_baseline(path, snapshot):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, sort_keys=True)


def run():
    log.info("Polling RDAP for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    raw = fetch_rdap(DNS_DOMAIN)
    current = normalize_rdap(raw)
    baseline = load_baseline(SNAPSHOT_PATH)

    if baseline is None:
        log.info("No baseline snapshot yet. Saving current RDAP state as the trusted baseline.")
        save_baseline(SNAPSHOT_PATH, current)
        return

    alerts = diff_rdap_snapshot(baseline, current)

    if not alerts:
        log.info("OK: RDAP record matches the trusted baseline. No hijack signal.")
        return

    log.warning("HIJACK SIGNAL for %s:", DNS_DOMAIN)
    for alert in alerts:
        log.warning("  - %s", alert)
    log.warning(
        "This is a registrar-side action, not something the Cloudflare DNS API can fix. "
        "Re-lock the domain, reset registrar credentials and MFA, or contact the registrar's "
        "abuse team / ICANN's Transfer Emergency Action Contact (TEAC)."
    )

    # Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
    # accepted for consistency with the other fixes in this repo, and would be
    # used to manage records inside a zone already delegated to Cloudflare via
    # https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but
    # that endpoint has no way to re-lock a domain or change registrar-level
    # ownership fields, so this script never calls it.
    if not DRY_RUN:
        log.info("DRY_RUN is false, but this check never writes. Fix the registrar by hand.")


if __name__ == "__main__":
    run()
