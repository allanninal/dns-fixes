"""Detect a duplicate or misplaced all mechanism in an SPF record and
optionally repair it via Cloudflare. Safe by default. Set DRY_RUN=false
to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("spf_all_mechanism")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def check_spf_all_mechanism(spf_record):
    """Pure decision function. No I/O.

    Input: raw SPF TXT record string, e.g.
      'v=spf1 include:_spf.google.com ~all include:sendgrid.net -all'

    Output: {
      'ok': bool,
      'all_count': int,
      'all_position_ok': bool,   # True if the (first) all-token is the last token
      'unreachable_tokens': list[str],  # tokens after the first all-token
      'issue': str | None        # 'duplicate_all' | 'all_not_last' | None
    }
    """
    tokens = spf_record.strip().split()
    if tokens and tokens[0].lower() == "v=spf1":
        tokens = tokens[1:]

    all_indexes = [i for i, t in enumerate(tokens) if t.lstrip("+-~?").lower() == "all"]
    all_count = len(all_indexes)

    if all_count == 0:
        return {
            "ok": False,
            "all_count": 0,
            "all_position_ok": False,
            "unreachable_tokens": [],
            "issue": "all_not_last",
        }

    first_all_index = all_indexes[0]
    all_position_ok = first_all_index == len(tokens) - 1
    unreachable_tokens = tokens[first_all_index + 1:]

    issue = None
    if all_count > 1:
        issue = "duplicate_all"
    elif not all_position_ok:
        issue = "all_not_last"

    return {
        "ok": issue is None,
        "all_count": all_count,
        "all_position_ok": all_position_ok,
        "unreachable_tokens": unreachable_tokens,
        "issue": issue,
    }


def rebuild_spf_record(spf_record, qualifier="-"):
    """Rebuild a corrected record: dedupe/move all to the end with the chosen qualifier."""
    tokens = spf_record.strip().split()
    prefix = []
    if tokens and tokens[0].lower() == "v=spf1":
        prefix = [tokens[0]]
        tokens = tokens[1:]
    else:
        prefix = ["v=spf1"]

    kept = [t for t in tokens if t.lstrip("+-~?").lower() != "all"]
    return " ".join(prefix + kept + [f"{qualifier}all"])


def fetch_spf_record(domain):
    """Query TXT records and return the one starting with v=spf1. Requires network."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    answer = resolver.resolve(domain, "TXT")
    for rdata in answer:
        text = b"".join(rdata.strings).decode("utf-8", "ignore")
        if text.lower().startswith("v=spf1"):
            return text
    return None


def find_spf_record_id(domain):
    """Find the SPF TXT record via the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": "TXT", "name": domain}, timeout=30)
    r.raise_for_status()
    for record in r.json().get("result", []):
        content = record.get("content", "").lower()
        if content.startswith("v=spf1") or content.startswith('"v=spf1'):
            return record["id"]
    return None


def replace_spf_record(domain, record_id, corrected_content):
    """Replace the malformed SPF TXT record with the corrected content."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"

    if DRY_RUN:
        log.info("[dry run] would update TXT record %s at %s to: %s", record_id, domain, corrected_content)
        return

    requests.patch(
        url, headers=headers,
        json={"type": "TXT", "name": domain, "content": corrected_content},
        timeout=30,
    ).raise_for_status()
    log.info("Updated SPF record for %s", domain)


def run():
    spf_record = fetch_spf_record(DNS_DOMAIN)
    if not spf_record:
        log.warning("No v=spf1 TXT record found for %s", DNS_DOMAIN)
        return

    result = check_spf_all_mechanism(spf_record)
    log.info("SPF for %s: %s", DNS_DOMAIN, result)

    if result["ok"]:
        log.info("Nothing to repair.")
        return

    corrected = rebuild_spf_record(spf_record, qualifier="-")
    log.info("Proposed corrected record: %s", corrected)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("Issue found but no Cloudflare credentials set. Skipping repair.")
        return

    record_id = find_spf_record_id(DNS_DOMAIN)
    if not record_id:
        log.warning("Could not find the SPF TXT record via the Cloudflare API.")
        return

    replace_spf_record(DNS_DOMAIN, record_id, corrected)


if __name__ == "__main__":
    run()
