"""Detect DNSSEC stuck on pending after a domain transfer-in.
Diagnostic only: adding or removing a DS record is a registry level action
taken through the registrar's portal or EPP, not something the Cloudflare
DNS API can touch, so this script never writes anything.

Environment:
  DNS_DOMAIN              domain to check (default: example.com)
  CLOUDFLARE_API_TOKEN    accepted for consistency with the other fixes
                          in this repo, unused (see note in run())
  CLOUDFLARE_ZONE_ID      accepted for consistency with the other fixes
                          in this repo, unused (see note in run())
  DRY_RUN                 default "true"; this script never writes
                          regardless of this flag
  HOURS_SINCE_TRANSFER    how long ago the transfer completed (default: 72)
  PENDING_THRESHOLD_HOURS how long to wait before flagging as stuck (default: 48)
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_ds_pending")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
HOURS_SINCE_TRANSFER = float(os.environ.get("HOURS_SINCE_TRANSFER", "72"))
PENDING_THRESHOLD_HOURS = float(os.environ.get("PENDING_THRESHOLD_HOURS", "48"))


def ds_state(cds_digest, cdnskey_present, parent_ds_digests, hours_since_transfer,
             pending_threshold_hours=48.0):
    """Pure decision logic, no I/O.

    cds_digest: digest string parsed from the child's CDS record (or None if absent)
    cdnskey_present: whether a CDNSKEY record is published at the child
    parent_ds_digests: list of digest strings currently published as DS at the parent/registry
    hours_since_transfer: elapsed time since the transfer-in completed
    pending_threshold_hours: how long to wait before flagging as stuck (registrars
      typically poll every 24-48h)

    Returns one of: "ok" (DS matches child's signal), "not_signed" (no CDS/CDNSKEY,
    nothing to publish), "pending_ok" (mismatch but still within normal propagation
    window), "stuck_pending" (mismatch beyond threshold, registrar action needed),
    "orphaned_ds" (DS exists at parent but child has no CDS/CDNSKEY at all)
    """
    if not cds_digest and not cdnskey_present:
        return "orphaned_ds" if parent_ds_digests else "not_signed"
    if cds_digest and cds_digest in parent_ds_digests:
        return "ok"
    if hours_since_transfer < pending_threshold_hours:
        return "pending_ok"
    return "stuck_pending"


def get_child_signals(domain):
    """dnspython, read-only. Returns (cds_digest, cdnskey_present)."""
    import dns.resolver

    cds_digest = None
    try:
        answer = dns.resolver.resolve(domain, "CDS")
        cds_digest = str(answer[0]).split()[-1].lower()
    except Exception:
        pass

    cdnskey_present = False
    try:
        dns.resolver.resolve(domain, "CDNSKEY")
        cdnskey_present = True
    except Exception:
        pass

    return cds_digest, cdnskey_present


def get_parent_ds_digests(domain):
    """dnspython, read-only. Returns the list of digest strings published as
    DS at a normal recursive resolver.
    """
    import dns.resolver

    digests = []
    try:
        answer = dns.resolver.resolve(domain, "DS")
        for rdata in answer:
            digests.append(str(rdata).split()[-1].lower())
    except Exception:
        pass
    return digests


def run():
    log.info("Checking DNSSEC delegation for %s (DRY_RUN=%s)", DNS_DOMAIN, DRY_RUN)

    cds_digest, cdnskey_present = get_child_signals(DNS_DOMAIN)
    parent_ds_digests = get_parent_ds_digests(DNS_DOMAIN)

    log.info("Child CDS digest: %s", cds_digest)
    log.info("Child CDNSKEY present: %s", cdnskey_present)
    log.info("Parent DS digests: %s", parent_ds_digests)

    state = ds_state(cds_digest, cdnskey_present, parent_ds_digests,
                      HOURS_SINCE_TRANSFER, PENDING_THRESHOLD_HOURS)

    if state == "ok":
        log.info("OK: the parent DS record matches the zone's current key. Nothing to do.")
    elif state == "not_signed":
        log.info("NOT SIGNED: the zone publishes no CDS/CDNSKEY and the parent has no DS. Nothing to reconcile yet.")
    elif state == "pending_ok":
        log.info(
            "PENDING (normal): the DS does not match yet, but only %.1f hour(s) have passed "
            "since the transfer. Registrars typically poll every 24-48 hours. Check again later.",
            HOURS_SINCE_TRANSFER,
        )
    elif state == "orphaned_ds":
        log.warning(
            "ORPHANED DS: the registry still has a DS record but the zone publishes no "
            "CDS/CDNSKEY at all. Contact the registrar to remove the orphaned DS record."
        )
    else:
        log.warning(
            "STUCK PENDING: %.1f hour(s) have passed since the transfer and the parent DS "
            "still does not match the zone's CDS. This is a registrar-side fix, not something "
            "the Cloudflare DNS API can change. Add or correct the DS record in the new "
            "registrar's DNSSEC dashboard using the CDS/CDNSKEY values shown at the DNS host.",
            HOURS_SINCE_TRANSFER,
        )

    # Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
    # accepted for consistency with the other fixes in this repo, and would be
    # used to manage records inside a zone already delegated to Cloudflare via
    # https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but that
    # endpoint only manages zone records like A/CNAME/TXT, not registry level DS
    # delegation, so this script never calls it.
    if not DRY_RUN:
        log.info("DRY_RUN is false, but this check never writes. Fix the DS record at the registrar by hand.")


if __name__ == "__main__":
    run()
