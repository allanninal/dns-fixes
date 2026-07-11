"""Detect duplicate v=spf1 TXT records on a domain, and optionally
repair the zone via Cloudflare by merging them into one record.

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
log = logging.getLogger("duplicate_spf_records")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"

ALL_QUALIFIERS = ("-all", "~all", "+all", "all", "?all")
QUALIFIER_STRENGTH = {"-all": 3, "~all": 2, "?all": 1, "+all": 0, "all": 0}


def merge_spf_records(spf_strings):
    """Pure decision function. No I/O.

    spf_strings: list of raw TXT record strings, each starting with "v=spf1".

    Returns None if the list is empty, returns the single string unchanged
    if there is only one, and if there are two or more, merges every
    mechanism and modifier from all of them into one new "v=spf1 ..."
    string, de-duplicated and ending with the strictest "all" qualifier
    found across the inputs.
    """
    records = [s.strip() for s in spf_strings if s and s.strip().startswith("v=spf1")]
    if not records:
        return None
    if len(records) == 1:
        return records[0]

    merged = []
    seen = set()
    strongest_qualifier = "?all"

    for record in records:
        tokens = record.split()[1:]  # drop the leading "v=spf1"
        for token in tokens:
            if token in ALL_QUALIFIERS:
                if QUALIFIER_STRENGTH.get(token, 0) > QUALIFIER_STRENGTH.get(strongest_qualifier, 0):
                    strongest_qualifier = token
                continue
            if token not in seen:
                seen.add(token)
                merged.append(token)

    final_qualifier = "-all" if strongest_qualifier in ("-all", "?all") else strongest_qualifier
    return "v=spf1 " + " ".join(merged + [final_qualifier])


def query_spf_records(domain):
    """Return every TXT string on the domain that starts with v=spf1."""
    import dns.resolver

    answers = dns.resolver.resolve(domain, "TXT")
    found = []
    for rdata in answers:
        text = b"".join(rdata.strings).decode("utf-8", errors="replace")
        if text.startswith("v=spf1"):
            found.append(text)
    return found


def list_spf_txt_records(domain):
    """List the id and content of every v=spf1 TXT record via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": "TXT", "name": domain, "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return [
        {"id": rec["id"], "content": rec["content"]}
        for rec in r.json()["result"]
        if rec["content"].strip('"').startswith("v=spf1")
    ]


def delete_record(record_id):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would delete record %s", record_id)
        return
    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted record %s", record_id)


def create_txt_record(domain, content):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    body = {"type": "TXT", "name": domain, "content": content, "ttl": 1}
    if DRY_RUN:
        log.info("[dry run] would create merged TXT record: %s", content)
        return
    r = requests.post(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Created merged record: %s", content)


def run():
    records = query_spf_records(DNS_DOMAIN)
    if len(records) <= 1:
        log.info("No duplicate SPF records found for %s (%d found).", DNS_DOMAIN, len(records))
        return

    log.warning("%s has %d v=spf1 TXT records, permerror risk.", DNS_DOMAIN, len(records))
    merged = merge_spf_records(records)
    log.info("Merged record: %s", merged)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    zone_records = list_spf_txt_records(DNS_DOMAIN)
    for rec in zone_records:
        delete_record(rec["id"])
    create_txt_record(DNS_DOMAIN, merged)
    log.info("Done.")


if __name__ == "__main__":
    run()
