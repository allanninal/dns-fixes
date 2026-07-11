"""List DNS records before writing, then create or update instead of
blindly POSTing a duplicate. Repairs the write through Cloudflare.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the name to check, e.g. "app.example.com"
  DNS_RECORD_TYPE          record type to check, default "A"
  DNS_RECORD_CONTENT       desired content, e.g. an IP for an A record
  DNS_RECORD_TTL           desired TTL, default 300
  DNS_RECORD_PROXIED       "true" or "false", default "false"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("duplicate_record_write_conflict")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "app.example.com")
DNS_RECORD_TYPE = os.environ.get("DNS_RECORD_TYPE", "A")
DNS_RECORD_CONTENT = os.environ.get("DNS_RECORD_CONTENT", "203.0.113.10")
DNS_RECORD_TTL = int(os.environ.get("DNS_RECORD_TTL", "300"))
DNS_RECORD_PROXIED = os.environ.get("DNS_RECORD_PROXIED", "false").lower() == "true"
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def plan_dns_write(existing_records, desired):
    """Pure decision function. No I/O.

    existing_records: list of {id, name, type, content, ttl, proxied}
                       already at (desired['name'], desired['type'])
    desired: {name, type, content, ttl, proxied}

    Returns one of:
      {"action": "create", "body": desired}
      {"action": "noop", "id": <id>}
      {"action": "update", "id": <id>, "body": {changed fields only}}

    Pure decision logic, no I/O: given zero existing records -> create;
    given one existing record identical to desired -> noop;
    given one existing record differing in content/ttl/proxied -> update
    with only the diff; (a CNAME-vs-other-type conflict is modeled as a
    separate existing record at the same name with a different type,
    which the caller must resolve by choosing which record wins).
    """
    if not existing_records:
        return {"action": "create", "body": desired}

    current = existing_records[0]
    diff = {}
    for field in ("content", "ttl", "proxied"):
        if field in desired and current.get(field) != desired[field]:
            diff[field] = desired[field]

    if not diff:
        return {"action": "noop", "id": current["id"]}

    return {"action": "update", "id": current["id"], "body": diff}


def resolve_via_dns(domain, record_type):
    """Look up what a public resolver actually returns right now, using
    dnspython. Informational only, used before deciding what to touch.
    """
    import dns.resolver

    try:
        answer = dns.resolver.resolve(domain, record_type)
        return [str(rdata) for rdata in answer]
    except dns.resolver.NXDOMAIN:
        return []
    except dns.resolver.NoAnswer:
        return []


def list_existing_records(name, record_type):
    """List DNS records at the exact name and type through the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": record_type, "name.exact": name}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return [
        {
            "id": rec["id"],
            "name": rec["name"],
            "type": rec["type"],
            "content": rec["content"],
            "ttl": rec.get("ttl", 1),
            "proxied": rec.get("proxied", False),
        }
        for rec in r.json()["result"]
    ]


def create_record(body):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    if DRY_RUN:
        log.info("[dry run] would create record %s", body)
        return
    r = requests.post(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Created record %s", body)


def update_record(record_id, body):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    if DRY_RUN:
        log.info("[dry run] would update record %s with %s", record_id, body)
        return
    r = requests.patch(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Updated record %s with %s", record_id, body)


def run():
    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Nothing to reconcile for %s.", DNS_DOMAIN)
        return

    desired = {
        "name": DNS_DOMAIN,
        "type": DNS_RECORD_TYPE,
        "content": DNS_RECORD_CONTENT,
        "ttl": DNS_RECORD_TTL,
        "proxied": DNS_RECORD_PROXIED,
    }

    existing = list_existing_records(DNS_DOMAIN, DNS_RECORD_TYPE)
    plan = plan_dns_write(existing, desired)

    if plan["action"] == "noop":
        log.info("%s already matches the desired state. Nothing to do.", DNS_DOMAIN)
        return

    if plan["action"] == "create":
        log.info("%s has no existing %s record. Creating.", DNS_DOMAIN, DNS_RECORD_TYPE)
        create_record(plan["body"])
        return

    log.info("%s exists but differs. Updating in place instead of duplicating.", DNS_DOMAIN)
    update_record(plan["id"], plan["body"])


if __name__ == "__main__":
    run()
