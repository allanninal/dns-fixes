"""Check a host's live TLS certificate expiry over a raw socket, and if the
failure is a missing or wrong CAA record, repair it through the Cloudflare
DNS API. Safe by default: DRY_RUN only reports the plan until turned off.
"""
import os
import logging
from datetime import datetime, timezone
from typing import Literal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_tls_expiry")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
CA_TO_PERMIT = os.environ.get("CA_TO_PERMIT", "letsencrypt.org")
WARN_AT_DAYS = int(os.environ.get("WARN_AT_DAYS", "21"))
CRIT_AT_DAYS = int(os.environ.get("CRIT_AT_DAYS", "7"))


def days_until_expiry(not_after: datetime, now: datetime) -> int:
    """Pure function, no I/O. Both datetimes should be timezone-aware."""
    return (not_after - now).days


def classify(
    days: int, warn_at: int = 21, crit_at: int = 7
) -> Literal["ok", "warn", "critical", "expired"]:
    """Pure function, no I/O. Classifies remaining days into a severity."""
    if days < 0:
        return "expired"
    if days <= crit_at:
        return "critical"
    if days <= warn_at:
        return "warn"
    return "ok"


def fetch_peer_certificate(host: str, port: int = 443):
    """Open a raw TLS socket with SNI set and read the peer certificate."""
    import socket
    import ssl

    context = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=15) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls_sock:
            return tls_sock.getpeercert()


def parse_not_after(cert: dict) -> datetime:
    """Parse the certificate's notAfter field (e.g. 'Sep  1 00:00:00 2026 GMT')."""
    from datetime import datetime as dt

    return dt.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)


def check_caa(domain: str) -> list:
    """Return the list of CA domains permitted to issue for this name via CAA."""
    import dns.resolver

    try:
        answers = dns.resolver.resolve(domain, "CAA")
    except dns.resolver.NoAnswer:
        return []
    except dns.resolver.NXDOMAIN:
        return []
    permitted = []
    for rdata in answers:
        tag = rdata.tag.decode() if isinstance(rdata.tag, bytes) else rdata.tag
        if tag == "issue":
            value = rdata.value.decode() if isinstance(rdata.value, bytes) else rdata.value
            permitted.append(value)
    return permitted


def add_caa_record(domain: str, ca_domain: str) -> None:
    """Add a CAA record permitting ca_domain to issue for domain, via Cloudflare."""
    import requests

    if DRY_RUN:
        log.info("[dry run] would add CAA record on %s permitting %s", domain, ca_domain)
        return

    url = f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records"
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "type": "CAA",
        "name": domain,
        "data": {"flags": 0, "tag": "issue", "value": ca_domain},
    }
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    log.info("Added CAA record on %s permitting %s", domain, ca_domain)


def run():
    log.info("Checking TLS certificate for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    cert = fetch_peer_certificate(DNS_DOMAIN)
    not_after = parse_not_after(cert)
    now = datetime.now(timezone.utc)
    days = days_until_expiry(not_after, now)
    severity = classify(days, WARN_AT_DAYS, CRIT_AT_DAYS)

    log.info("Certificate for %s expires in %d day(s): %s", DNS_DOMAIN, days, severity)

    if severity == "ok":
        log.info("OK: certificate has plenty of runway left.")
        return

    log.warning("Certificate for %s is %s (%d days remaining).", DNS_DOMAIN, severity, days)

    permitted_cas = check_caa(DNS_DOMAIN)
    if permitted_cas and not any(CA_TO_PERMIT in ca for ca in permitted_cas):
        log.warning(
            "CAA record on %s only permits %s, which blocks issuance from %s.",
            DNS_DOMAIN, permitted_cas, CA_TO_PERMIT,
        )
        if CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID:
            add_caa_record(DNS_DOMAIN, CA_TO_PERMIT)
        else:
            log.warning(
                "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to let this script add the CAA record."
            )
    else:
        log.warning(
            "CAA looks fine. Check the ACME client and its port 80/443 or DNS-01 automation by hand: "
            "run 'sudo certbot renew --dry-run' on the host to see the exact failure."
        )


if __name__ == "__main__":
    run()
