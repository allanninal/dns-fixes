"""Detect stale/orphaned DS records left behind after a DNSSEC key rollover,
and optionally repair Cloudflare-side DNSSEC signaling. Safe by default.
Set DRY_RUN=false to let it write.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stale_ds_records")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def find_stale_ds(ds_records, dnskey_records):
    """Pure decision function. No I/O.

    ds_records: [{"key_tag": int, "algorithm": int, "digest_type": int,
                  "digest": str}, ...] from the parent/registry
    dnskey_records: [{"key_tag": int, "algorithm": int, "flags": int,
                      "digest": str}, ...] computed from the child zone's
                      live DNSKEYs (digest pre-hashed per digest_type)

    Returns the subset of ds_records whose (key_tag, algorithm, digest) has
    no matching entry in dnskey_records. Those are stale/orphaned DS
    records that should be removed at the registrar.
    """
    live = {
        (k["key_tag"], k["algorithm"], k["digest"].lower())
        for k in dnskey_records
    }
    stale = []
    for ds in ds_records:
        fingerprint = (ds["key_tag"], ds["algorithm"], ds["digest"].lower())
        if fingerprint not in live:
            stale.append(ds)
    return stale


def query_parent_ds(domain):
    """Query the DS RRset the parent zone is publishing. Requires network."""
    import dns.resolver

    records = []
    answer = dns.resolver.resolve(domain, "DS")
    for rdata in answer:
        records.append({
            "key_tag": rdata.key_tag,
            "algorithm": rdata.algorithm,
            "digest_type": rdata.digest_type,
            "digest": rdata.digest.hex(),
        })
    return records


def query_child_dnskeys_as_ds(domain):
    """Query the child zone's live DNSKEYs and compute the DS digest each
    one would produce, so it can be compared against the parent's DS set.
    Requires network.
    """
    import dns.resolver
    import dns.dnssec
    import dns.rdatatype

    records = []
    answer = dns.resolver.resolve(domain, "DNSKEY")
    for rdata in answer:
        ds = dns.dnssec.make_ds(domain, rdata, "SHA256")
        records.append({
            "key_tag": ds.key_tag,
            "algorithm": ds.algorithm,
            "flags": rdata.flags,
            "digest": ds.digest.hex(),
        })
    return records


def list_cloudflare_dnssec_ds(zone_id, token):
    """List DS records Cloudflare is publishing for its own DNSSEC signaling."""
    import requests

    headers = {"Authorization": f"Bearer {token}"}
    url = f"{CF_API}/zones/{zone_id}/dnssec"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("result", {})


def repair_cloudflare_dnssec(zone_id, token):
    """Nudge Cloudflare to refresh its DNSSEC state after a rollover.

    Cloudflare manages its own DS lifecycle once DNSSEC is enabled on the
    zone; this simply re-asserts the desired state so any stale signaling
    on the Cloudflare side is refreshed. The registrar-side DS record,
    if the domain uses a third-party registrar, must be removed manually.
    """
    import requests

    if DRY_RUN:
        log.info("[dry run] would PATCH DNSSEC state for zone %s", zone_id)
        return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{CF_API}/zones/{zone_id}/dnssec"
    requests.patch(url, headers=headers, json={"status": "active"}, timeout=30).raise_for_status()
    log.info("Refreshed Cloudflare DNSSEC state for zone %s", zone_id)


def run():
    parent_ds = query_parent_ds(DNS_DOMAIN)
    child_ds_equivalents = query_child_dnskeys_as_ds(DNS_DOMAIN)
    stale = find_stale_ds(parent_ds, child_ds_equivalents)

    if not stale:
        log.info("No stale DS records found for %s.", DNS_DOMAIN)
        return

    for ds in stale:
        log.warning(
            "Stale DS found: key_tag=%s algorithm=%s digest_type=%s (no matching DNSKEY)",
            ds["key_tag"], ds["algorithm"], ds["digest_type"],
        )

    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning(
            "Stale DS records found. This zone's DS lives at the registrar; "
            "remove it there manually, or via CDS/CDNSKEY delete signaling."
        )
        return

    repair_cloudflare_dnssec(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)
    log.warning(
        "Cloudflare-side DNSSEC state refreshed, but the registrar-side DS "
        "record still needs manual removal if the registrar is third-party."
    )


if __name__ == "__main__":
    run()
