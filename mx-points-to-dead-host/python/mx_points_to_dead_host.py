"""Detect an MX record that points at a host with no working SMTP
listener on port 25 (dangling hostname, refused connection, or
timeout), and optionally repair the zone via Cloudflare by repointing
the record at a known-good mail host.

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the domain to check, e.g. "example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
  KNOWN_GOOD_MX_HOST       hostname to repoint to when all MX hosts are down
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mx_points_to_dead_host")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
KNOWN_GOOD_MX_HOST = os.environ.get("KNOWN_GOOD_MX_HOST", "")

CF_API = "https://api.cloudflare.com/client/v4"
SMTP_PORT = 25
SOCKET_TIMEOUT = 5


def classify_mx_health(mx_records, resolved_ips, port25_results):
    """Pure decision function. No I/O.

    mx_records: list of (priority, hostname) tuples.
    resolved_ips: dict mapping hostname -> list of ip strings; an empty
      list means NXDOMAIN or no A/AAAA record (a dangling hostname).
    port25_results: dict mapping hostname -> one of "connected",
      "refused", "timeout", or "no_dns".

    Returns a dict with one entry per hostname, "healthy", "dangling",
    or "unreachable", plus an "all_down" boolean that is True only when
    every hostname's status is not "connected".
    """
    status = {}
    for _, hostname in mx_records:
        ips = resolved_ips.get(hostname, [])
        result = port25_results.get(hostname, "no_dns")
        if not ips or result == "no_dns":
            status[hostname] = "dangling"
        elif result == "connected":
            status[hostname] = "healthy"
        else:
            status[hostname] = "unreachable"

    all_down = all(v != "healthy" for v in status.values()) if status else True
    return {**status, "all_down": all_down}


def fetch_mx_records(domain):
    """Return a list of (preference, exchange) tuples for the domain."""
    import dns.resolver

    answers = dns.resolver.resolve(domain, "MX")
    records = [(rdata.preference, str(rdata.exchange).rstrip(".")) for rdata in answers]
    records.sort(key=lambda item: item[0])
    return records


def resolve_host(hostname):
    """Return a list of IP address strings for hostname, or [] if none."""
    import dns.resolver
    import dns.exception

    ips = []
    for rtype in ("A", "AAAA"):
        try:
            answers = dns.resolver.resolve(hostname, rtype)
            ips.extend(str(rdata) for rdata in answers)
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.exception.DNSException):
            continue
    return ips


def probe_port25(hostname, ip):
    """Open a raw socket to ip:25 and read the SMTP banner.

    Returns "connected" if a banner starting with "220" is read,
    "refused" on connection refused, "timeout" on a timeout, and
    "no_dns" if ip is falsy (nothing to connect to).
    """
    import socket

    if not ip:
        return "no_dns"

    try:
        with socket.create_connection((ip, SMTP_PORT), timeout=SOCKET_TIMEOUT) as sock:
            sock.settimeout(SOCKET_TIMEOUT)
            banner = sock.recv(256)
            return "connected" if banner.startswith(b"220") else "refused"
    except ConnectionRefusedError:
        return "refused"
    except (socket.timeout, TimeoutError):
        return "timeout"
    except OSError:
        return "refused"


def list_mx_zone_records(domain):
    """List the id, priority, and content of every MX record via Cloudflare."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"type": "MX", "name": domain, "per_page": 100}
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]


def repoint_mx_record(record_id, domain, new_content, priority):
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    body = {"type": "MX", "name": domain, "content": new_content, "priority": priority, "ttl": 3600}
    if DRY_RUN:
        log.info("[dry run] would repoint record %s to %s (priority %s)", record_id, new_content, priority)
        return
    r = requests.patch(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    log.info("Repointed record %s to %s (priority %s)", record_id, new_content, priority)


def run():
    records = fetch_mx_records(DNS_DOMAIN)
    if not records:
        log.info("No MX records found for %s.", DNS_DOMAIN)
        return

    resolved_ips = {}
    port25_results = {}
    for _, hostname in records:
        ips = resolve_host(hostname)
        resolved_ips[hostname] = ips
        port25_results[hostname] = probe_port25(hostname, ips[0] if ips else None)

    health = classify_mx_health(records, resolved_ips, port25_results)
    for _, hostname in records:
        log.info("MX host %s: %s", hostname, health[hostname])

    if not health["all_down"]:
        log.info("At least one MX host for %s is healthy. No repair needed.", DNS_DOMAIN)
        return

    log.warning("All MX hosts for %s are down. Mail delivery is fully broken.", DNS_DOMAIN)

    if not KNOWN_GOOD_MX_HOST:
        log.warning("No known-good replacement host provided. Not repairing, only reporting.")
        return

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Not repairing, only reporting.")
        return

    zone_records = list_mx_zone_records(DNS_DOMAIN)
    for rec in zone_records:
        repoint_mx_record(rec["id"], DNS_DOMAIN, KNOWN_GOOD_MX_HOST, rec["priority"])
    log.info("Done.")


if __name__ == "__main__":
    run()
