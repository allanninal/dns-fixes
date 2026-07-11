"""Detect a DNS record a reconciler is about to write without proof of
ownership, and repair it via Cloudflare only when the ownership marker
matches. Safe to run on a schedule. Stays in dry run until DRY_RUN=false.

Guide: https://www.allanninal.dev/dns/unowned-record-overwritten/
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_record_ownership")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DNS_OWNER_ID = os.environ.get("DNS_OWNER_ID", "team-a")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"


def decide_action(intended: dict, live: dict | None, owner_id: str) -> str:
    """
    intended: {"name": str, "type": str, "content": str, "owner": str}
    live: {"name": str, "type": str, "content": str, "comment": str|None} or None if absent
    owner_id: this reconciler's own owner tag, e.g. "team-a"
    Returns one of: "create", "update", "skip_conflict", "noop"
    Pure decision logic, no I/O: given the intended record, the current live record
    (or None), and this instance's owner id, decide whether it is safe to write.
    """
    if live is None:
        return "create"

    live_comment = live.get("comment") or ""
    live_owner = live_comment.split("managed-by:")[-1].strip() if "managed-by:" in live_comment else None

    if live_owner is None:
        return "skip_conflict"
    if live_owner != owner_id:
        return "skip_conflict"
    if live.get("content") == intended.get("content"):
        return "noop"
    return "update"


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import requests

    zone_id = CLOUDFLARE_ZONE_ID
    api_token = CLOUDFLARE_API_TOKEN
    owner_id = DNS_OWNER_ID
    dry_run = DRY_RUN
    domain = DNS_DOMAIN

    # In a real run, "desired" would come from Terraform state or a
    # Kubernetes Ingress spec. Here it is one example record derived from
    # DNS_DOMAIN, so the script has something concrete to reconcile.
    desired = [
        {"name": f"app.{domain}", "type": "A", "content": "203.0.113.10", "owner": owner_id},
    ]

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"

    for intended in desired:
        resp = requests.get(base, headers=headers, params={"name": intended["name"], "type": intended["type"]}, timeout=30)
        resp.raise_for_status()
        results = resp.json().get("result", [])
        live = results[0] if results else None

        action = decide_action(intended, live, owner_id)
        log.info("Record %s (%s): action=%s", intended["name"], intended["type"], action)

        if action == "noop":
            log.info("Already correct and owned. Nothing to do.")
            continue

        if action == "skip_conflict":
            log.warning(
                "Skipping %s: live record has no matching owner marker for '%s'. "
                "Refusing to overwrite a record this reconciler does not own.",
                intended["name"], owner_id,
            )
            continue

        comment = f"managed-by:{owner_id}"
        if action == "create":
            log.info("%s create %s -> %s", "Would" if dry_run else "Will", intended["name"], intended["content"])
            if not dry_run:
                requests.post(
                    base, headers=headers,
                    json={"type": intended["type"], "name": intended["name"], "content": intended["content"], "ttl": 300, "comment": comment},
                    timeout=30,
                ).raise_for_status()
        elif action == "update":
            log.info("%s update %s -> %s", "Would" if dry_run else "Will", intended["name"], intended["content"])
            if not dry_run:
                requests.patch(
                    f"{base}/{live['id']}", headers=headers,
                    json={"content": intended["content"], "comment": comment},
                    timeout=30,
                ).raise_for_status()

    log.info("Done.")


if __name__ == "__main__":
    run()
