"""Detect a domain that is both transfer-locked and close to expiring.
Detection only. Removing a registrar transfer lock is an account or
registrar-portal action, not a Cloudflare DNS zone API call, so this
script never attempts a repair, it only reports the risky combination.
"""
import os
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_transfer_lock_risk")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
WARNING_DAYS = int(os.environ.get("WARNING_DAYS", "30"))

LOCK_STATUSES = {"clienttransferprohibited", "servertransferprohibited"}


def assess_transfer_risk(status_codes: list, expiration_date: datetime, now: datetime, warning_days: int = 30) -> dict:
    """
    Pure decision logic, no I/O.
    Input: status_codes (raw RDAP/WHOIS status strings, any case/spacing),
           expiration_date (the domain's expiration as a datetime),
           now (the current time as a datetime, injected for testability),
           warning_days (how many days out counts as "near expiry").
    Output: {
        "locked": bool,
        "days_until_expiry": int,
        "at_risk": bool,
    }
    Logic: normalize status_codes to lowercase with spaces removed, and check
    membership against clienttransferprohibited/servertransferprohibited.
    Compute days_until_expiry as the whole number of days between now and
    expiration_date. at_risk is True only when locked is True AND
    days_until_expiry <= warning_days AND days_until_expiry >= 0.
    """
    normalized = {s.lower().replace(" ", "") for s in status_codes}
    locked = bool(normalized & LOCK_STATUSES)
    days_until_expiry = (expiration_date - now).days

    at_risk = locked and 0 <= days_until_expiry <= warning_days

    return {
        "locked": locked,
        "days_until_expiry": days_until_expiry,
        "at_risk": at_risk,
    }


def fetch_rdap(domain: str) -> dict:
    """Query RDAP for a domain and return the raw JSON response."""
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=30)
    r.raise_for_status()
    return r.json()


def extract_expiration(rdap_data: dict) -> datetime:
    """Pull the expiration eventDate out of an RDAP response."""
    for event in rdap_data.get("events", []):
        if event.get("eventAction") == "expiration":
            iso = event["eventDate"].replace("Z", "+00:00")
            return datetime.fromisoformat(iso).astimezone(timezone.utc)
    raise ValueError("No expiration event found in RDAP response")


def report(domain: str, result: dict, status_codes: list) -> None:
    """Report the finding. Replace with email, Slack, or a webhook in production."""
    if not result["at_risk"]:
        log.info(
            "OK: %s locked=%s, %d day(s) until expiry, no action needed",
            domain, result["locked"], result["days_until_expiry"],
        )
        return
    prefix = "[dry run] would flag" if DRY_RUN else "FLAG"
    log.warning(
        "%s: %s is transfer-locked with only %d day(s) left before expiry. statuses=%s. "
        "Unlock at the registrar dashboard, or let auto-renew process first. "
        "This cannot be fixed through the Cloudflare DNS zone API.",
        prefix, domain, result["days_until_expiry"], status_codes,
    )


def run():
    log.info("Checking transfer lock risk for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    rdap_data = fetch_rdap(DNS_DOMAIN)
    status_codes = rdap_data.get("status", [])
    expiration_date = extract_expiration(rdap_data)
    now = datetime.now(timezone.utc)

    result = assess_transfer_risk(status_codes, expiration_date, now, WARNING_DAYS)
    report(DNS_DOMAIN, result, status_codes)


if __name__ == "__main__":
    run()
