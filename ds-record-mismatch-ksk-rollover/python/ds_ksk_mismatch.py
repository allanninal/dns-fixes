"""Detect a DS record mismatch after a KSK rollover, and optionally refresh
Cloudflare-side DNSSEC signaling. Safe by default. Set DRY_RUN=false to write.

Environment:
    DNS_DOMAIN              the zone to check, e.g. example.com
    CLOUDFLARE_API_TOKEN    Cloudflare API token (only needed for the repair)
    CLOUDFLARE_ZONE_ID      Cloudflare zone id (only needed for the repair)
    DRY_RUN                 "true" (default) reports only, "false" writes
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ds_ksk_mismatch")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def ds_matches_ksk(published_ds, expected_ds):
    """Pure decision function. No I/O.

    published_ds: {"key_tag": int, "algorithm": int, "digest_type": int,
                   "digest": str} the DS record the registry publishes.
    expected_ds: same shape, computed fresh from the zone's current live KSK.

    Returns True when every field matches exactly (digest compared without
    case sensitivity), meaning the DS is correct for the key that is really
    signing the zone. Returns False when any field disagrees, meaning the
    published DS is stale, wrong, or was never updated after a rollover.
    """
    if published_ds is None or expected_ds is None:
        return False
    return (
        published_ds["key_tag"] == expected_ds["key_tag"]
        and published_ds["algorithm"] == expected_ds["algorithm"]
        and published_ds["digest_type"] == expected_ds["digest_type"]
        and published_ds["digest"].lower() == expected_ds["digest"].lower()
    )


def query_published_ds(domain):
    """Query the DS record the parent zone is publishing. Requires network."""
    import dns.resolver

    answer = dns.resolver.resolve(domain, "DS")
    rdata = answer[0]
    return {
        "key_tag": rdata.key_tag,
        "algorithm": rdata.algorithm,
        "digest_type": rdata.digest_type,
        "digest": rdata.digest.hex(),
    }


def query_expected_ds_from_live_ksk(domain):
    """Query the zone's live KSK (DNSKEY with the SEP flag set) and compute
    the DS digest it should produce. Requires network.
    """
    import dns.resolver
    import dns.dnssec

    answer = dns.resolver.resolve(domain, "DNSKEY")
    ksk = next((r for r in answer if r.flags & 0x0001), None)
    if ksk is None:
        return None
    ds = dns.dnssec.make_ds(domain, ksk, "SHA256")
    return {
        "key_tag": ds.key_tag,
        "algorithm": ds.algorithm,
        "digest_type": ds.digest_type,
        "digest": ds.digest.hex(),
    }


def get_cloudflare_dnssec_status(zone_id, token):
    """Read Cloudflare's own DNSSEC status for the zone."""
    import requests

    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{CF_API}/zones/{zone_id}/dnssec", headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("result", {})


def repair_cloudflare_dnssec(zone_id, token):
    """Nudge Cloudflare to re-publish its DNSSEC state after a rollover.

    Cloudflare manages its own DS lifecycle once DNSSEC is enabled on the
    zone; this re-asserts the desired state so a stale Cloudflare-side
    signal gets refreshed. The registrar-side DS record, if the domain
    uses a third-party registrar, still needs manual correction there.
    """
    import requests

    if DRY_RUN:
        log.info("[dry run] would PATCH DNSSEC state for zone %s", zone_id)
        return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.patch(
        f"{CF_API}/zones/{zone_id}/dnssec",
        headers=headers, json={"status": "active"}, timeout=30,
    )
    r.raise_for_status()
    log.info("Refreshed Cloudflare DNSSEC state for zone %s", zone_id)


def run():
    published_ds = query_published_ds(DNS_DOMAIN)
    expected_ds = query_expected_ds_from_live_ksk(DNS_DOMAIN)

    if ds_matches_ksk(published_ds, expected_ds):
        log.info("DS record for %s matches the live KSK. Nothing to do.", DNS_DOMAIN)
        return

    log.warning(
        "DS mismatch for %s. Published key_tag=%s, expected key_tag=%s (from live KSK).",
        DNS_DOMAIN,
        published_ds["key_tag"] if published_ds else None,
        expected_ds["key_tag"] if expected_ds else None,
    )

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning(
            "DS mismatch found. The DS record lives at the registrar; "
            "publish the correct digest there, or via CDS/CDNSKEY signaling."
        )
        return

    repair_cloudflare_dnssec(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)
    log.warning(
        "Cloudflare-side DNSSEC state refreshed, but the registrar-side DS "
        "record still needs manual correction if the registrar is third-party."
    )


if __name__ == "__main__":
    run()
