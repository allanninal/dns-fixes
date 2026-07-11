"""Detect a DKIM public key that is stale after a private key rotation and
repair it via Cloudflare. Safe to run on a schedule. Stays in dry run
until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dkim_key_rotation_check")

MISSING = "missing"


def dkim_key_mismatch(published_txt: str, deployed_pubkey_b64: str):
    """Pure decision function. No network, no I/O.

    Parses the p= tag out of a published DKIM TXT record value, handling
    the quoted/concatenated chunk style DNS providers sometimes return per
    RFC 6376, and compares it against the base64 public key actually
    derived from the deployed private key.

    Returns True if the keys differ (stale), False if they match (ok),
    or the MISSING sentinel string if there is no DKIM record at all so
    callers can branch on mismatch vs missing vs revoked.
    """
    if not published_txt:
        return MISSING

    # Join quoted/concatenated TXT chunks into one string, RFC 6376 style.
    joined = "".join(part.strip().strip('"') for part in published_txt.split('" "'))
    joined = joined.strip().strip('"')

    p_value = None
    for tag in joined.split(";"):
        tag = tag.strip()
        if tag.startswith("p="):
            p_value = tag[2:].strip()
            break

    if p_value is None:
        return MISSING
    if p_value == "":
        # Empty p= means the key was deliberately revoked, not stale.
        return False

    return p_value != deployed_pubkey_b64.strip()


def run():
    # Imported lazily so the pure function above can be tested with no
    # network or crypto libraries installed at all.
    import subprocess
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    selector = os.environ["DKIM_SELECTOR"]
    private_key_path = os.environ["DKIM_PRIVATE_KEY_PATH"]
    ttl = int(os.environ.get("RECORD_TTL", "3600"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    name = f"{selector}._domainkey.{domain}"

    try:
        answer = dns.resolver.resolve(name, "TXT")
        published_txt = "".join(
            chunk.decode() if isinstance(chunk, bytes) else chunk
            for rdata in answer for chunk in rdata.strings
        )
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        published_txt = ""

    deployed_pubkey_b64 = subprocess.run(
        ["openssl", "rsa", "-in", private_key_path, "-pubout", "-outform", "DER"],
        capture_output=True, check=True,
    ).stdout
    deployed_pubkey_b64 = subprocess.run(
        ["openssl", "base64", "-A"], input=deployed_pubkey_b64,
        capture_output=True, check=True,
    ).stdout.decode().strip()

    result = dkim_key_mismatch(published_txt, deployed_pubkey_b64)

    if result == MISSING:
        log.warning("No DKIM record found at %s. This is a missing record, not staleness.", name)
        return
    if result is False:
        log.info("DKIM key at %s matches the deployed private key. Nothing to do.", name)
        return

    log.warning("DKIM key at %s is stale: DNS still serves the old public key.", name)
    correct_value = f"v=DKIM1; k=rsa; p={deployed_pubkey_b64}"

    log.info("%s update TXT record for %s.", "Would" if dry_run else "Will", name)
    if dry_run:
        return

    lookup = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers={"Authorization": f"Bearer {api_token}"},
        params={"type": "TXT", "name": name},
        timeout=30,
    )
    lookup.raise_for_status()
    existing = lookup.json().get("result", [])

    payload = {"type": "TXT", "name": name, "content": correct_value, "ttl": ttl}
    if existing:
        record_id = existing[0]["id"]
        resp = requests.put(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}",
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
            json=payload, timeout=30,
        )
    else:
        resp = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
            json=payload, timeout=30,
        )
    resp.raise_for_status()
    log.info("Published the correct DKIM public key at %s", name)


if __name__ == "__main__":
    run()
