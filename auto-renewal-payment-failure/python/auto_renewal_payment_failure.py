"""Detect a stalled auto-renewal caused by a failed payment charge, using
RDAP as the source of truth, and reconcile the CAA iodef alert record
through the Cloudflare API. Renewing the domain itself always happens at
the registrar, since that is a billing action, not a DNS zone record.
Stays in dry run until DRY_RUN=false.
"""
import os
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("auto_renewal_payment_failure")

GRACE_STATUSES = {"autorenewperiod", "redemptionperiod", "pendingdelete"}


def evaluate_renewal(expiration_iso, previous_expiration_iso, now_iso, statuses, warn_days=30):
    """
    Pure decision function. No I/O.

    expiration_iso: current RDAP expiration eventDate string.
    previous_expiration_iso: expiration eventDate recorded on a prior run,
        or None if this is the first run.
    now_iso: current time as an ISO string, injected for testability.
    statuses: list of RDAP status strings for the domain.
    warn_days: how many days out counts as inside the warning window.

    Returns a dict:
      days_remaining: int
      stalled: bool, True if the expiration date did not move forward
               since the previous check
      in_grace_period: bool, True if any status flags a lapsed domain
      payment_likely_failed: bool, True when the domain is inside the
               warning window and either stalled or already in a grace
               period, which points at a failed auto-renew charge
    """
    expiration = datetime.fromisoformat(expiration_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    now = datetime.fromisoformat(now_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    days_remaining = int((expiration - now).total_seconds() // 86400)

    stalled = False
    if previous_expiration_iso:
        previous = datetime.fromisoformat(previous_expiration_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
        stalled = expiration <= previous

    lowered = {s.lower() for s in statuses}
    in_grace_period = bool(lowered & GRACE_STATUSES)

    inside_window = days_remaining <= warn_days
    payment_likely_failed = in_grace_period or (inside_window and stalled)

    return {
        "days_remaining": days_remaining,
        "stalled": stalled,
        "in_grace_period": in_grace_period,
        "payment_likely_failed": payment_likely_failed,
    }


def fetch_rdap(domain):
    import requests

    r = requests.get(f"https://rdap.org/domain/{domain}", timeout=30)
    r.raise_for_status()
    data = r.json()
    expiration_iso = None
    for event in data.get("events", []):
        if event.get("eventAction") == "expiration":
            expiration_iso = event["eventDate"]
    if not expiration_iso:
        raise ValueError(f"No expiration event found in RDAP response for {domain}")
    return expiration_iso, data.get("status", [])


def find_caa_iodef_record(zone_id, headers, name):
    import requests

    r = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        params={"type": "CAA", "name": name},
        timeout=30,
    )
    r.raise_for_status()
    for record in r.json().get("result", []):
        if record.get("data", {}).get("tag") == "iodef":
            return record
    return None


def reconcile_iodef_record(zone_id, headers, name, contact_uri, dry_run):
    existing = find_caa_iodef_record(zone_id, headers, name)
    body = {"type": "CAA", "name": name, "data": {"flags": 0, "tag": "iodef", "value": contact_uri}, "ttl": 3600}

    if existing and existing.get("data", {}).get("value") == contact_uri:
        log.info("CAA iodef record already points at %s, nothing to change.", contact_uri)
        return

    if dry_run:
        action = "update" if existing else "create"
        log.info("Dry run: would %s CAA iodef record on %s to %s", action, name, contact_uri)
        return

    import requests

    if existing:
        resp = requests.put(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{existing['id']}",
            headers=headers, json=body, timeout=30,
        )
    else:
        resp = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers=headers, json=body, timeout=30,
        )
    resp.raise_for_status()
    log.info("CAA iodef record on %s now points at %s", name, contact_uri)


def run():
    domain = os.environ["DNS_DOMAIN"]
    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"
    contact_uri = os.environ.get("ALERT_CONTACT_URI", "mailto:domains@example.com")
    previous_expiration_iso = os.environ.get("PREVIOUS_EXPIRATION_ISO") or None

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    expiration_iso, statuses = fetch_rdap(domain)
    now_iso = datetime.now(timezone.utc).isoformat()

    result = evaluate_renewal(expiration_iso, previous_expiration_iso, now_iso, statuses)
    log.info(
        "%s expires %s: %d day(s) remaining, stalled=%s, in_grace_period=%s",
        domain, expiration_iso, result["days_remaining"], result["stalled"], result["in_grace_period"],
    )

    if not result["payment_likely_failed"]:
        log.info("OK: %s renewed on schedule, no sign of a failed charge.", domain)
        return

    log.warning(
        "Renewal for %s looks stalled. Auto-renew is likely failing at the payment step. "
        "Update the card or pay manually at the registrar, this cannot be fixed through the DNS provider API.",
        domain,
    )
    reconcile_iodef_record(zone_id, headers, domain, contact_uri, dry_run)


if __name__ == "__main__":
    run()
