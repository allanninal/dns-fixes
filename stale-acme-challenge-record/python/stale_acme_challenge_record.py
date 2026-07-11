"""Detect a stale _acme-challenge TXT record left behind by a failed
ACME DNS-01 renewal, and optionally repair the zone via Cloudflare by
deleting the stale record(s).

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  CURRENT_CHALLENGE_TOKEN  the token the ACME client is currently
                           trying to validate, if any (leave unset or
                           empty when no validation is in flight)
  STALE_TIMEOUT_SECONDS    default 3600; age past which a record is
                           always considered stale
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stale_acme_challenge_record")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CURRENT_CHALLENGE_TOKEN = os.environ.get("CURRENT_CHALLENGE_TOKEN") or None
STALE_TIMEOUT_SECONDS = int(os.environ.get("STALE_TIMEOUT_SECONDS", "3600"))
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"
GRACE_SECONDS = 300


def find_stale_challenge_records(records, current_token, now_ts, timeout_s=3600):
    """Pure decision function. No I/O.

    records: list of TXT record dicts for _acme-challenge.<domain>, each
             with 'id', 'content', and 'modified_on' as epoch seconds.
    current_token: the token the ACME client is currently trying to
             validate, or None if no validation is in flight.
    now_ts: the current time as epoch seconds.
    timeout_s: age in seconds past which a record is always stale,
             regardless of its content, since a real challenge never
             takes anywhere near this long.

    Returns the list of record ids that are stale: any record older
    than timeout_s, or, when current_token is not None, any record
    whose content differs from current_token once it is older than a
    short grace period (so a record published moments ago as part of
    the in-flight challenge is never flagged before it has had a
    chance to be read by the CA).
    """
    stale_ids = []
    for record in records:
        age = now_ts - record["modified_on"]
        if age > timeout_s:
            stale_ids.append(record["id"])
            continue
        if current_token is not None and record["content"] != current_token and age > GRACE_SECONDS:
            stale_ids.append(record["id"])
    return stale_ids


def list_challenge_records(domain):
    """List every TXT record at _acme-challenge.<domain> via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": "TXT", "name": f"_acme-challenge.{domain}", "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]


def delete_record(record_id):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted record %s", record_id)


def run():
    records = list_challenge_records(DNS_DOMAIN)
    if not records:
        log.info("No _acme-challenge TXT records found for %s.", DNS_DOMAIN)
        return

    now_ts = int(time.time())
    stale_ids = find_stale_challenge_records(records, CURRENT_CHALLENGE_TOKEN, now_ts, STALE_TIMEOUT_SECONDS)
    if not stale_ids:
        log.info("All %d TXT record(s) at _acme-challenge.%s look current.", len(records), DNS_DOMAIN)
        return

    for record_id in stale_ids:
        log.warning("Stale _acme-challenge TXT record for %s: id %s", DNS_DOMAIN, record_id)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    for record_id in stale_ids:
        delete_record(record_id)
    log.info("Done. %d stale record(s) %s.", len(stale_ids), "would be removed" if DRY_RUN else "removed")


if __name__ == "__main__":
    run()
