"""Detect a dangling CNAME that enables subdomain takeover, and optionally
repair it via Cloudflare by removing the offending record.
Safe by default. Set DRY_RUN=false to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dangling_cname_takeover")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "promo.example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"

# Snippets a provider's "nothing lives here" page tends to contain.
UNCLAIMED_SIGNATURES = (
    "there isn't a github pages site here",
    "the specified bucket does not exist",
    "no such app",
    "domain mapping not found",
)


def classify_cname_target(target_status):
    """Pure decision function. No I/O.

    target_status looks like:
      {"resolves": True, "http_status": 200, "body_snippet": "..."}

    Returns one of:
      "ok"        - target resolves and does not look unclaimed
      "dangling"  - target does not resolve (NXDOMAIN) or the response body
                    matches a known "not claimed" signature
      "unknown"   - could not tell, treat as needing a human look
    """
    if target_status is None:
        return "unknown"

    if not target_status.get("resolves", False):
        return "dangling"

    snippet = (target_status.get("body_snippet") or "").lower()
    for signature in UNCLAIMED_SIGNATURES:
        if signature in snippet:
            return "dangling"

    http_status = target_status.get("http_status")
    if http_status is None:
        return "unknown"

    return "ok"


def resolve_cname_chain(domain):
    """Follow the CNAME for domain and probe the final target. Requires network."""
    import dns.resolver
    import requests

    try:
        answer = dns.resolver.resolve(domain, "CNAME")
        target = str(answer[0].target).rstrip(".")
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        return None, {"resolves": False, "http_status": None, "body_snippet": ""}

    try:
        dns.resolver.resolve(target, "A")
        resolves = True
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        return target, {"resolves": False, "http_status": None, "body_snippet": ""}

    try:
        r = requests.get(f"https://{domain}/", timeout=10)
        return target, {"resolves": resolves, "http_status": r.status_code, "body_snippet": r.text[:2000]}
    except requests.RequestException as exc:
        log.warning("HTTPS probe for %s failed: %s", domain, exc)
        return target, {"resolves": resolves, "http_status": None, "body_snippet": ""}


def find_cname_record_id(domain):
    """Find the dangling CNAME record via the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": "CNAME", "name": domain}, timeout=30)
    r.raise_for_status()
    result = r.json().get("result", [])
    return result[0]["id"] if result else None


def remove_dangling_cname(domain, record_id):
    """Delete the dangling CNAME record so the name can no longer be claimed against it."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}"

    if DRY_RUN:
        log.info("[dry run] would delete dangling CNAME record %s for %s", record_id, domain)
        return

    requests.delete(url, headers=headers, timeout=30).raise_for_status()
    log.info("Deleted dangling CNAME record for %s", domain)


def run():
    target, status = resolve_cname_chain(DNS_DOMAIN)
    verdict = classify_cname_target(status)
    log.info("Subdomain %s (target %s) classified as: %s", DNS_DOMAIN, target, verdict)

    if verdict != "dangling":
        log.info("Nothing to repair.")
        return

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("Dangling CNAME found but no Cloudflare credentials set. Skipping repair.")
        return

    record_id = find_cname_record_id(DNS_DOMAIN)
    if not record_id:
        log.warning("Could not find the CNAME record via the Cloudflare API.")
        return

    remove_dangling_cname(DNS_DOMAIN, record_id)


if __name__ == "__main__":
    run()
