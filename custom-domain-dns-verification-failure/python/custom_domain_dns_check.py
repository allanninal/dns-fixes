"""Detect a GitHub Pages custom domain DNS check failure and repair it via Cloudflare.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("custom_domain_dns_check")

GITHUB_PAGES_A_RECORDS = {
    "185.199.108.153",
    "185.199.109.153",
    "185.199.110.153",
    "185.199.111.153",
}


def diagnose_pages_dns(apex_a_records: set, www_cname_target, required_a_records: set, expected_cname_suffix: str) -> dict:
    """Pure decision function. No network, no I/O."""
    missing = required_a_records - apex_a_records
    extra = apex_a_records - required_a_records
    apex_ok = not missing and not extra
    www_ok = bool(www_cname_target) and www_cname_target.rstrip(".").endswith(expected_cname_suffix.lstrip("."))
    return {
        "apex_ok": apex_ok,
        "apex_missing": missing,
        "apex_extra": extra,
        "www_ok": www_ok,
        "www_target": www_cname_target,
    }


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    github_hostname = os.environ.get("GITHUB_PAGES_HOSTNAME", "yourusername.github.io")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    try:
        apex_answer = dns.resolver.resolve(domain, "A")
        apex_a_records = {str(r) for r in apex_answer}
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        apex_a_records = set()

    www_name = f"www.{domain}"
    try:
        cname_answer = dns.resolver.resolve(www_name, "CNAME")
        www_cname_target = str(cname_answer[0].target).rstrip(".")
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        www_cname_target = None

    report = diagnose_pages_dns(apex_a_records, www_cname_target, GITHUB_PAGES_A_RECORDS, ".github.io")
    log.info("Apex ok=%s missing=%s extra=%s", report["apex_ok"], report["apex_missing"], report["apex_extra"])
    log.info("www ok=%s target=%s", report["www_ok"], report["www_target"])

    if report["apex_ok"] and report["www_ok"]:
        log.info("Nothing to repair. DNS matches GitHub Pages requirements.")
        return

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"

    if not report["apex_ok"]:
        log.info("Apex %s is wrong. %s replace the A records with the four GitHub Pages IPs.",
                  domain, "Would" if dry_run else "Will")
        if not dry_run:
            existing = requests.get(base, headers=headers, params={"type": "A", "name": domain}, timeout=30).json()
            for record in existing.get("result", []):
                requests.delete(f"{base}/{record['id']}", headers=headers, timeout=30).raise_for_status()
            for ip in sorted(GITHUB_PAGES_A_RECORDS):
                requests.post(base, headers=headers, json={"type": "A", "name": domain, "content": ip, "ttl": 300}, timeout=30).raise_for_status()

    if not report["www_ok"]:
        log.info("www.%s is wrong. %s replace it with a CNAME to %s.",
                  domain, "Would" if dry_run else "Will", github_hostname)
        if not dry_run:
            existing = requests.get(base, headers=headers, params={"name": www_name}, timeout=30).json()
            for record in existing.get("result", []):
                requests.delete(f"{base}/{record['id']}", headers=headers, timeout=30).raise_for_status()
            requests.post(base, headers=headers, json={"type": "CNAME", "name": www_name, "content": github_hostname, "ttl": 300}, timeout=30).raise_for_status()

    log.info("Done.")


if __name__ == "__main__":
    run()
