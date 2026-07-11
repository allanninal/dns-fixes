"""Detect a TLS certificate SAN/hostname mismatch and optionally repair it via Cloudflare.
Safe by default. Set DRY_RUN=false to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tls_san_hostname_mismatch")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
CLOUDFLARE_CERT_PACK_ID = os.environ.get("CLOUDFLARE_CERT_PACK_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def san_covers_hostname(hostname: str, san_dns_names: list) -> bool:
    """Pure decision function. No I/O.

    Given the requested hostname and the list of dNSName strings pulled from
    the certificate's SAN extension, normalize case, then return True if the
    hostname is an exact match to any entry or matches a leftmost-label
    wildcard entry (e.g. '*.example.com' matches 'app.example.com' but not
    'a.b.example.com' or the bare apex 'example.com'). Returns False otherwise.
    """
    host = hostname.strip().lower().rstrip(".")
    names = [n.strip().lower().rstrip(".") for n in san_dns_names]

    if host in names:
        return True

    host_labels = host.split(".")
    for name in names:
        if not name.startswith("*."):
            continue
        wildcard_suffix = name[2:]
        # Wildcard covers exactly one leftmost label: 'app.example.com' but not
        # 'a.b.example.com', and never the bare suffix itself ('example.com').
        if len(host_labels) < 3:
            continue
        remainder = ".".join(host_labels[1:])
        if remainder == wildcard_suffix:
            return True
    return False


def fetch_san_for_hostname(hostname, port=443):
    """Open a TLS connection with SNI set to hostname and return its SAN dNSNames. Requires network."""
    import socket
    import ssl

    ctx = ssl.create_default_context()
    with socket.create_connection((hostname, port), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=hostname) as tls:
            cert = tls.getpeercert()
    names = [value for key, value in cert.get("subjectAltName", ()) if key == "DNS"]
    return names


def get_cert_pack_hosts():
    """Read the current hosts array off a Cloudflare Advanced Certificate pack."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/ssl/certificate_packs/{CLOUDFLARE_CERT_PACK_ID}"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()["result"].get("hosts", [])


def add_hostname_to_cert_pack(hostname):
    """Add the missing hostname as a SAN by patching the Cloudflare certificate pack."""
    import requests

    if DRY_RUN:
        log.info("[dry run] would add %s to certificate pack %s", hostname, CLOUDFLARE_CERT_PACK_ID)
        return

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}", "Content-Type": "application/json"}
    url = f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/ssl/certificate_packs/{CLOUDFLARE_CERT_PACK_ID}"
    hosts = get_cert_pack_hosts()
    if hostname not in hosts:
        hosts = hosts + [hostname]
    requests.patch(url, headers=headers, json={"hosts": hosts}, timeout=30).raise_for_status()
    log.info("Requested certificate pack update to include %s", hostname)


def run():
    hostname = DNS_DOMAIN
    san_names = fetch_san_for_hostname(hostname)
    log.info("SAN entries served for %s: %s", hostname, san_names)

    if san_covers_hostname(hostname, san_names):
        log.info("Nothing to repair. %s is already covered.", hostname)
        return

    log.warning("Hostname %s is missing from the served certificate's SAN list.", hostname)

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID and CLOUDFLARE_CERT_PACK_ID):
        log.warning("Mismatch found but no Cloudflare certificate pack credentials set. Skipping repair.")
        return

    add_hostname_to_cert_pack(hostname)


if __name__ == "__main__":
    run()
