"""Detect a missing, duplicated, or malformed DMARC TXT record at
_dmarc.{domain}, and optionally repair it via Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dmarc_record_missing_or_malformed")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"

VALID_P_VALUES = {"none", "quarantine", "reject"}
DEFAULT_REPAIR_CONTENT = "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@{domain}; pct=100"


def validate_dmarc_record(txt_strings):
    """Pure decision function. No I/O.

    txt_strings: list of raw TXT strings found at _dmarc (empty list if none).

    Returns a dict:
      {"status": "missing" | "duplicate" | "invalid" | "valid",
       "reason": str or None,
       "tags": dict or None}

    Checks that exactly one string exists, that it parses per DMARC tag
    grammar (starts with v=DMARC1, has a p= tag immediately after with an
    allowed value, and no tag key repeats).
    """
    if len(txt_strings) == 0:
        return {"status": "missing", "reason": "no TXT record found at _dmarc", "tags": None}

    if len(txt_strings) > 1:
        return {"status": "duplicate", "reason": "more than one TXT record found at _dmarc", "tags": None}

    raw = txt_strings[0].strip().strip('"')
    parts = [p.strip() for p in raw.split(";") if p.strip() != ""]

    if len(parts) == 0:
        return {"status": "invalid", "reason": "empty record", "tags": None}

    tags = {}
    order = []
    for part in parts:
        if "=" not in part:
            return {"status": "invalid", "reason": f"tag '{part}' has no value", "tags": None}
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key in tags:
            return {"status": "invalid", "reason": f"tag '{key}' appears more than once", "tags": None}
        tags[key] = value
        order.append(key)

    if order[0] != "v" or tags.get("v") != "DMARC1":
        return {"status": "invalid", "reason": "record must start with v=DMARC1", "tags": tags}

    if len(order) < 2 or order[1] != "p":
        return {"status": "invalid", "reason": "p= tag must come immediately after v=DMARC1", "tags": tags}

    if tags.get("p") not in VALID_P_VALUES:
        return {"status": "invalid", "reason": "p= must be none, quarantine, or reject", "tags": tags}

    return {"status": "valid", "reason": None, "tags": tags}


def query_dmarc_txt(domain):
    """Return every TXT string found at _dmarc.{domain}."""
    import dns.resolver

    name = f"_dmarc.{domain}"
    try:
        answers = dns.resolver.resolve(name, "TXT")
    except dns.resolver.NXDOMAIN:
        return []
    except dns.resolver.NoAnswer:
        return []
    found = []
    for rdata in answers:
        text = b"".join(rdata.strings).decode("utf-8", errors="replace")
        found.append(text)
    return found


def list_dmarc_records(domain):
    """List the id and content of every TXT record at _dmarc via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": "TXT", "name": f"_dmarc.{domain}", "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return [{"id": rec["id"], "content": rec["content"]} for rec in r.json()["result"]]


def create_dmarc_record(domain, content):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    body = {"type": "TXT", "name": "_dmarc", "content": content, "ttl": 1}
    if DRY_RUN:
        log.info("[dry run] would create _dmarc TXT record: %s", content)
        return
    r = requests.post(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Created _dmarc TXT record: %s", content)


def update_dmarc_record(record_id, content):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    body = {"type": "TXT", "name": "_dmarc", "content": content, "ttl": 1}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would update record %s to: %s", record_id, content)
        return
    r = requests.put(url, headers=headers, json=body, timeout=30)
    r.raise_for_status()
    log.info("Updated record %s to: %s", record_id, content)


def delete_dmarc_record(record_id):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete duplicate record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted duplicate record %s", record_id)


def run():
    txt_strings = query_dmarc_txt(DNS_DOMAIN)
    result = validate_dmarc_record(txt_strings)

    if result["status"] == "valid":
        log.info("_dmarc.%s already has a valid DMARC record. Nothing to do.", DNS_DOMAIN)
        return

    log.warning("_dmarc.%s is %s: %s", DNS_DOMAIN, result["status"], result["reason"])

    repair_content = DEFAULT_REPAIR_CONTENT.format(domain=DNS_DOMAIN)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    zone_records = list_dmarc_records(DNS_DOMAIN)
    if len(zone_records) == 0:
        create_dmarc_record(DNS_DOMAIN, repair_content)
    elif len(zone_records) == 1:
        update_dmarc_record(zone_records[0]["id"], repair_content)
    else:
        # duplicate records: remove all but one, then fix the survivor
        for rec in zone_records[1:]:
            delete_dmarc_record(rec["id"])
        update_dmarc_record(zone_records[0]["id"], repair_content)

    log.info("Done.")


if __name__ == "__main__":
    run()
