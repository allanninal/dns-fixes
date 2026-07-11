"""Check that both Microsoft 365 DKIM CNAME selectors are published correctly,
and optionally repair them through the Cloudflare API.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. yourdomain.com
  DKIM_SELECTOR1_TARGET    expected CNAME target for selector1, from
                           Get-DkimSigningConfig -Identity yourdomain.com
  DKIM_SELECTOR2_TARGET    expected CNAME target for selector2
  CLOUDFLARE_API_TOKEN     only needed for repair
  CLOUDFLARE_ZONE_ID       only needed for repair
  DRY_RUN                  defaults to "true"
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dkim_selector_check")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "yourdomain.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def check_dkim_selectors(selector_records: dict, expected_targets: dict) -> list:
    """Pure decision function. No I/O.

    selector_records: {"selector1": {"type": "CNAME"|"TXT"|None, "target": str|None}, "selector2": {...}}
    expected_targets: {"selector1": "selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com", "selector2": "..."}

    Returns a list of finding dicts like
      {"selector": "selector2", "issue": "missing"|"wrong_type"|"target_mismatch", "found": ..., "expected": ...}
    for each selector that fails to resolve as a CNAME to its expected target.
    An empty list means healthy.
    """
    findings = []
    for selector, expected in expected_targets.items():
        record = selector_records.get(selector) or {"type": None, "target": None}
        rtype = record.get("type")
        target = record.get("target")

        if rtype is None:
            findings.append({"selector": selector, "issue": "missing", "found": None, "expected": expected})
            continue
        if rtype != "CNAME":
            findings.append({"selector": selector, "issue": "wrong_type", "found": rtype, "expected": expected})
            continue
        if target != expected:
            findings.append({"selector": selector, "issue": "target_mismatch", "found": target, "expected": expected})

    return findings


def query_selector_records(domain: str) -> dict:
    """Query CNAME (and TXT, to detect a wrong-type conflict) for both selectors."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    records = {}
    for selector in ("selector1", "selector2"):
        name = f"{selector}._domainkey.{domain}"
        try:
            answer = resolver.resolve(name, "CNAME")
            records[selector] = {"type": "CNAME", "target": str(answer[0].target).rstrip(".")}
            continue
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            pass
        except Exception as exc:
            log.warning("CNAME query for %s failed: %s", name, exc)

        try:
            resolver.resolve(name, "TXT")
            records[selector] = {"type": "TXT", "target": None}
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            records[selector] = {"type": None, "target": None}
        except Exception as exc:
            log.warning("TXT query for %s failed: %s", name, exc)
            records[selector] = {"type": None, "target": None}

    return records


def find_conflicting_record_id(domain: str, selector: str, record_type: str):
    """Find an existing record of record_type at the selector name via the Cloudflare API."""
    import requests

    name = f"{selector}._domainkey.{domain}"
    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": record_type, "name": name}, timeout=30)
    r.raise_for_status()
    result = r.json().get("result", [])
    return result[0]["id"] if result else None


def publish_selector_cname(domain: str, selector: str, target: str, conflicting_txt_id: str = None):
    """Delete a conflicting TXT record, if any, then create the correct CNAME."""
    import requests

    name = f"{selector}._domainkey.{domain}"
    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    base = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"

    if DRY_RUN:
        if conflicting_txt_id:
            log.info("[dry run] would delete TXT record %s at %s", conflicting_txt_id, name)
        log.info("[dry run] would create CNAME %s -> %s", name, target)
        return

    if conflicting_txt_id:
        requests.delete(f"{base}/{conflicting_txt_id}", headers=headers, timeout=30).raise_for_status()

    requests.post(
        base,
        headers=headers,
        json={"type": "CNAME", "name": name, "content": target, "proxied": False},
        timeout=30,
    ).raise_for_status()
    log.info("Published CNAME %s -> %s", name, target)


def run():
    expected_targets = {
        "selector1": os.environ.get("DKIM_SELECTOR1_TARGET", ""),
        "selector2": os.environ.get("DKIM_SELECTOR2_TARGET", ""),
    }
    if not all(expected_targets.values()):
        log.warning("Set DKIM_SELECTOR1_TARGET and DKIM_SELECTOR2_TARGET from Get-DkimSigningConfig first.")
        return

    records = query_selector_records(DNS_DOMAIN)
    findings = check_dkim_selectors(records, expected_targets)

    if not findings:
        log.info("Both DKIM selectors are healthy for %s.", DNS_DOMAIN)
        return

    for finding in findings:
        log.warning("selector=%s issue=%s found=%s expected=%s",
                    finding["selector"], finding["issue"], finding["found"], finding["expected"])

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("Issues found but no Cloudflare credentials set. Skipping repair.")
        return

    for finding in findings:
        selector = finding["selector"]
        conflicting_txt_id = None
        if finding["issue"] == "wrong_type":
            conflicting_txt_id = find_conflicting_record_id(DNS_DOMAIN, selector, "TXT")
        publish_selector_cname(DNS_DOMAIN, selector, finding["expected"], conflicting_txt_id)


if __name__ == "__main__":
    run()
