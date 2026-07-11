"""Detect a malformed DKIM TXT record and repair it via Cloudflare.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import re
import base64
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dkim_txt_check")

TAG_RE = re.compile(r"(v|k|p)=([^;]*)")


def validate_dkim_txt(strings: list) -> dict:
    """Pure decision function. No network, no I/O.

    strings is the list of character-strings dnspython returns for the
    TXT RRset at a selector, e.g. ['v=DKIM1; k=rsa; p=MIIBIjq...', '...rest'].
    """
    if strings is None or len(strings) == 0:
        return {"valid": False, "reason": "empty_key", "key_bytes": None}

    joined = "".join(strings)

    if '"' in joined or "\\" in joined:
        return {"valid": False, "reason": "embedded_quotes", "key_bytes": None}

    tags = dict(TAG_RE.findall(joined))
    p_value = tags.get("p", "").strip()

    if not p_value:
        return {"valid": False, "reason": "empty_key", "key_bytes": None}

    if " " in p_value or "\n" in p_value or "\t" in p_value:
        return {"valid": False, "reason": "embedded_quotes", "key_bytes": None}

    try:
        key_bytes = base64.b64decode(p_value, validate=True)
    except Exception:
        return {"valid": False, "reason": "not_base64", "key_bytes": None}

    return {"valid": True, "reason": "ok", "key_bytes": len(key_bytes)}


def run():
    # Imported lazily so the pure function above can be tested with no
    # network or crypto libraries installed at all.
    import dns.resolver
    import requests
    from cryptography.hazmat.primitives.serialization import load_der_public_key

    domain = os.environ["DNS_DOMAIN"]
    selector = os.environ.get("DKIM_SELECTOR", "selector1")
    new_record_value = os.environ.get("DKIM_RECORD_VALUE")
    ttl = int(os.environ.get("RECORD_TTL", "3600"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]

    name = f"{selector}._domainkey.{domain}"

    try:
        answer = dns.resolver.resolve(name, "TXT")
        rrsets = []
        for rdata in answer:
            strings = [s.decode() if isinstance(s, bytes) else s for s in rdata.strings]
            rrsets.append(strings)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        rrsets = []

    if len(rrsets) > 1:
        log.warning("Selector %s has %d separate TXT RRsets at the same name (multiple_txt_records)", selector, len(rrsets))
        outcome = {"valid": False, "reason": "multiple_txt_records", "key_bytes": None}
    elif len(rrsets) == 0:
        outcome = {"valid": False, "reason": "empty_key", "key_bytes": None}
    else:
        outcome = validate_dkim_txt(rrsets[0])

    log.info("Selector %s (%s): valid=%s reason=%s key_bytes=%s", selector, name, outcome["valid"], outcome["reason"], outcome["key_bytes"])

    if outcome["valid"]:
        # Belt and suspenders: also confirm cryptography can load the key.
        p_value = dict(TAG_RE.findall("".join(rrsets[0]))).get("p", "").strip()
        try:
            load_der_public_key(base64.b64decode(p_value))
            log.info("Key for %s loads as a valid public key.", name)
        except Exception as exc:
            log.warning("Key for %s decoded as base64 but did not load as a public key: %s", name, exc)
        return

    if not new_record_value:
        log.info("No DKIM_RECORD_VALUE set, skipping repair for %s.", selector)
        return

    log.info("%s remove the broken record(s) and republish %s.", "Would" if dry_run else "Will", name)
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

    for record in existing:
        del_resp = requests.delete(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record['id']}",
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=30,
        )
        del_resp.raise_for_status()
        log.info("Deleted broken TXT record %s at %s", record["id"], name)

    create_resp = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        json={"type": "TXT", "name": name, "content": new_record_value, "ttl": ttl},
        timeout=30,
    )
    create_resp.raise_for_status()
    log.info("Published corrected DKIM TXT record for %s", name)


if __name__ == "__main__":
    run()
