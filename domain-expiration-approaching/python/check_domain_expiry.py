"""Check a domain's real expiration date over RDAP and alert when it crosses
a warning threshold. Renewal itself always happens at the registrar, since
this is a billing state, not a DNS zone record. DRY_RUN only reports until
turned off, and even then this script only sends alerts, it never renews
anything on your behalf.
"""
import os
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_domain_expiry")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
WARN_THRESHOLDS_DAYS = [30, 14, 7, 1]


def days_until_expiry(expiration_iso: str, now_iso: str, warn_thresholds_days: list = None) -> dict:
    """
    Pure decision logic, no I/O.
    Input: expiration_iso (RDAP eventDate string, e.g. '2026-08-05T04:00:00Z'),
           now_iso (current time as ISO string, injected for testability),
           warn_thresholds_days (sorted descending list of alert thresholds).
    Output: {
        'days_remaining': int,
        'severity': 'ok' | 'warning' | 'critical' | 'expired',
        'triggered_threshold': int | None  # smallest threshold crossed, or None
    }
    Logic: parse both timestamps to UTC datetimes, compute
    days_remaining = floor((expiration - now).total_seconds() / 86400).
    If days_remaining < 0: severity='expired'.
    Else find the smallest threshold in warn_thresholds_days that is >= days_remaining;
    if none found, severity='ok', triggered_threshold=None;
    else severity='critical' if triggered_threshold <= 7 else 'warning'.
    """
    if warn_thresholds_days is None:
        warn_thresholds_days = [30, 14, 7, 1]

    expiration = datetime.fromisoformat(expiration_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    now = datetime.fromisoformat(now_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    days_remaining = int((expiration - now).total_seconds() // 86400)

    if days_remaining < 0:
        return {"days_remaining": days_remaining, "severity": "expired", "triggered_threshold": None}

    candidates = [t for t in warn_thresholds_days if t >= days_remaining]
    triggered_threshold = min(candidates) if candidates else None

    if triggered_threshold is None:
        severity = "ok"
    elif triggered_threshold <= 7:
        severity = "critical"
    else:
        severity = "warning"

    return {
        "days_remaining": days_remaining,
        "severity": severity,
        "triggered_threshold": triggered_threshold,
    }


def fetch_rdap_expiration(domain: str) -> str:
    """Query RDAP for a domain and return the expiration eventDate string."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=30)
    r.raise_for_status()
    data = r.json()
    for event in data.get("events", []):
        if event.get("eventAction") == "expiration":
            return event["eventDate"]
    raise ValueError(f"No expiration event found in RDAP response for {domain}")


def fetch_rdap_status(domain: str) -> list:
    """Query RDAP for a domain and return its status list."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=30)
    r.raise_for_status()
    return r.json().get("status", [])


def send_alert(domain: str, result: dict, statuses: list) -> None:
    """Send an alert. Replace with email, Slack, or a webhook call in production."""
    if DRY_RUN:
        log.info(
            "[dry run] would alert: %s is %s, %d day(s) remaining, statuses=%s",
            domain, result["severity"], result["days_remaining"], statuses,
        )
        return
    log.warning(
        "ALERT: %s is %s, %d day(s) remaining, statuses=%s. Renew at the registrar, "
        "this cannot be fixed through the DNS provider API.",
        domain, result["severity"], result["days_remaining"], statuses,
    )


def run():
    log.info("Checking domain expiration for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    expiration_iso = fetch_rdap_expiration(DNS_DOMAIN)
    statuses = fetch_rdap_status(DNS_DOMAIN)
    now_iso = datetime.now(timezone.utc).isoformat()

    result = days_until_expiry(expiration_iso, now_iso, WARN_THRESHOLDS_DAYS)
    log.info(
        "%s expires %s: %d day(s) remaining, severity=%s",
        DNS_DOMAIN, expiration_iso, result["days_remaining"], result["severity"],
    )

    grace_flags = {"pendingdelete", "redemptionperiod", "autorenewperiod"}
    lowered_statuses = [s.lower() for s in statuses]
    if any(flag in lowered_statuses for flag in grace_flags):
        log.warning("%s is already in a grace or pending-delete state: %s", DNS_DOMAIN, statuses)
        send_alert(DNS_DOMAIN, result, statuses)
        return

    if result["severity"] in ("warning", "critical", "expired"):
        send_alert(DNS_DOMAIN, result, statuses)
    else:
        log.info("OK: %s has plenty of runway left before renewal is needed.", DNS_DOMAIN)


if __name__ == "__main__":
    run()
