"""Detect a CNAME left behind at a name where an A record is wanted, and
repair it with one atomic Cloudflare PUT instead of a delete-then-create
race.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the name to change, e.g. "app.example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DESIRED_A_RECORD_IP      the IP address the A record should point to
  DESIRED_TTL              default "300"
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("cname_to_a")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DESIRED_A_RECORD_IP = os.environ.get("DESIRED_A_RECORD_IP", "203.0.113.10")
DESIRED_TTL = int(os.environ.get("DESIRED_TTL", "300"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def plan_rrset_change(live_records, desired):
    """Pure decision function. No I/O.

    live_records: list of {"id": str, "type": str, "content": str} for the
    records currently live at the desired name.
    desired: {"name": str, "type": str, "content": str, "ttl": int}

    Returns one of:
      {"action": "noop"}
        a record already matches the desired type and content
      {"action": "overwrite", "record_id": str}
        exactly one conflicting record of a different type exists at the
        name (for example a CNAME where an A record is wanted); a same
        record PUT should replace delete+create
      {"action": "create"}
        no record exists at the name yet
    """
    for rec in live_records:
        if rec["type"] == desired["type"] and rec["content"] == desired["content"]:
            return {"action": "noop"}

    conflicting = [r for r in live_records if r["type"] != desired["type"]]
    if len(conflicting) == 1:
        return {"action": "overwrite", "record_id": conflicting[0]["id"]}

    if not live_records:
        return {"action": "create"}

    return {"action": "noop"}


def list_records_at_name(domain):
    """List the DNS records Cloudflare has for a single name."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"name": domain}, timeout=30)
    r.raise_for_status()
    return [
        {"id": rec["id"], "type": rec["type"], "content": rec["content"]}
        for rec in r.json()["result"]
    ]


def overwrite_record(record_id, domain, ip, ttl):
    """Overwrite an existing record in place with a single PUT call."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"
    if DRY_RUN:
        log.info("[dry run] would PUT %s to type A, content %s", record_id, ip)
        return
    r = requests.put(
        url, headers=headers,
        json={"type": "A", "name": domain, "content": ip, "ttl": ttl},
        timeout=30,
    )
    r.raise_for_status()
    log.info("Overwrote record %s in place. Now type A, content %s.", record_id, ip)


def create_record(domain, ip, ttl):
    """Create a new A record. Only used when nothing exists at the name."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    if DRY_RUN:
        log.info("[dry run] would create A record for %s pointing to %s", domain, ip)
        return
    r = requests.post(
        url, headers=headers,
        json={"type": "A", "name": domain, "content": ip, "ttl": ttl},
        timeout=30,
    )
    r.raise_for_status()
    log.info("Created new A record for %s pointing to %s.", domain, ip)


def run():
    # Imported lazily so this module can be unit tested with no network
    # and no DNS libraries installed.
    import dns.resolver

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Cannot check or repair %s.", DNS_DOMAIN)
        return

    try:
        answers = dns.resolver.resolve(DNS_DOMAIN, "CNAME")
        log.info("Resolver still sees a CNAME for %s: %s", DNS_DOMAIN, answers[0].target)
    except Exception:
        log.info("Resolver shows no CNAME for %s", DNS_DOMAIN)

    live_records = list_records_at_name(DNS_DOMAIN)
    desired = {
        "name": DNS_DOMAIN, "type": "A",
        "content": DESIRED_A_RECORD_IP, "ttl": DESIRED_TTL,
    }
    plan = plan_rrset_change(live_records, desired)
    log.info("Plan for %s: %s", DNS_DOMAIN, plan)

    if plan["action"] == "noop":
        log.info("Nothing to do. %s already matches.", DNS_DOMAIN)
        return

    if plan["action"] == "overwrite":
        overwrite_record(plan["record_id"], DNS_DOMAIN, DESIRED_A_RECORD_IP, DESIRED_TTL)
    elif plan["action"] == "create":
        create_record(DNS_DOMAIN, DESIRED_A_RECORD_IP, DESIRED_TTL)


if __name__ == "__main__":
    run()
