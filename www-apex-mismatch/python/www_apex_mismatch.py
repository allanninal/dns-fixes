"""Detect a www/apex DNS mismatch and optionally repair it via Cloudflare.
Safe by default. Set DRY_RUN=false to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("www_apex_mismatch")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def diagnose_www_apex(apex_ips, apex_cname, www_ips, www_cname):
    """Pure decision function. No I/O.

    apex_ips/www_ips are resolved IP sets (empty set = NXDOMAIN/no record).
    apex_cname/www_cname are the CNAME target strings if present, else None.

    Returns one of: "ok", "apex_missing", "www_missing", "both_missing", "ip_mismatch"
    """
    apex_ok = bool(apex_ips) or bool(apex_cname)
    www_ok = bool(www_ips) or bool(www_cname)

    if not apex_ok and not www_ok:
        return "both_missing"
    if not apex_ok:
        return "apex_missing"
    if not www_ok:
        return "www_missing"
    if apex_ips and www_ips and apex_ips.isdisjoint(www_ips):
        return "ip_mismatch"
    return "ok"


def resolve_name(name):
    """Resolve A, AAAA, and CNAME for a name. Requires network."""
    import dns.resolver

    resolver = dns.resolver.Resolver()
    ips = set()
    cname = None
    for rtype in ("A", "AAAA"):
        try:
            answer = resolver.resolve(name, rtype)
            ips.update(str(r) for r in answer)
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            pass
        except Exception as exc:
            log.warning("Query for %s %s failed: %s", name, rtype, exc)
    try:
        answer = resolver.resolve(name, "CNAME")
        cname = str(answer[0].target).rstrip(".")
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        pass
    except Exception as exc:
        log.warning("Query for %s CNAME failed: %s", name, exc)
    return ips, cname


def find_record_id(name, rtype):
    """Find an existing record via the Cloudflare API, or None."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    r = requests.get(url, headers=headers, params={"type": rtype, "name": name}, timeout=30)
    r.raise_for_status()
    result = r.json().get("result", [])
    return result[0]["id"] if result else None


def create_record(rtype, name, content):
    """Create the missing record through the Cloudflare API."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records"

    if DRY_RUN:
        log.info("[dry run] would create %s record %s -> %s", rtype, name, content)
        return

    requests.post(
        url,
        headers=headers,
        json={"type": rtype, "name": name, "content": content, "ttl": 300, "proxied": False},
        timeout=30,
    ).raise_for_status()
    log.info("Created %s record %s -> %s", rtype, name, content)


def run():
    apex = DNS_DOMAIN
    www = f"www.{DNS_DOMAIN}"

    apex_ips, apex_cname = resolve_name(apex)
    www_ips, www_cname = resolve_name(www)

    verdict = diagnose_www_apex(apex_ips, apex_cname, www_ips, www_cname)
    log.info("Diagnosis for %s / %s: %s", apex, www, verdict)

    if verdict == "ok":
        log.info("Nothing to repair.")
        return

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("Mismatch found but no Cloudflare credentials set. Skipping repair.")
        return

    if verdict == "apex_missing" and www_ips:
        replacement_ip = os.environ.get("REPLACEMENT_IP", next(iter(www_ips)))
        if not find_record_id(apex, "A"):
            create_record("A", apex, replacement_ip)
    elif verdict == "www_missing" and (apex_ips or apex_cname):
        target = apex_cname or apex
        if not find_record_id(www, "CNAME"):
            create_record("CNAME", www, target)
    else:
        log.warning("Verdict %s needs a manual decision on which side is correct.", verdict)


if __name__ == "__main__":
    run()
