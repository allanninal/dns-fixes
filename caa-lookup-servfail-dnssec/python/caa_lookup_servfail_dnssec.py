"""Detect a broken DNSSEC chain that turns a CAA lookup into a SERVFAIL and,
optionally, check or change a Cloudflare zone's DNSSEC status. Safe to run
on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("caa_lookup_servfail_dnssec")


def diagnose_caa_dnssec_break(servfail_with_validation, ok_with_cd, ds_matches_dnskey, rrsig_expired):
    """Pure decision function. No DNS I/O, no network calls.

    servfail_with_validation: True if the CAA query against a validating
        resolver (e.g. dig @1.1.1.1 CAA example.com) returned SERVFAIL.
    ok_with_cd: True if the same query with checking disabled
        (dig @1.1.1.1 +cd CAA example.com) returned NOERROR.
    ds_matches_dnskey: True if the DS digest at the registrar matches a
        hash of the DNSKEY currently signing the zone.
    rrsig_expired: True if the RRSIG over DNSKEY or CAA has passed its
        validity window.

    Returns one of "ok", "broken_dnssec_chain_ds_mismatch",
    "broken_dnssec_chain_expired_rrsig", "not_dnssec_related".
    """
    if not servfail_with_validation:
        return "ok"
    if not ok_with_cd:
        return "not_dnssec_related"
    if rrsig_expired:
        return "broken_dnssec_chain_expired_rrsig"
    if not ds_matches_dnskey:
        return "broken_dnssec_chain_ds_mismatch"
    return "broken_dnssec_chain_ds_mismatch"


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import time
    import dns.resolver
    import dns.flags
    import dns.message
    import dns.query
    import dns.dnssec
    import dns.rdatatype
    import requests

    domain = os.environ["DNS_DOMAIN"]
    resolver_ip = os.environ.get("VALIDATING_RESOLVER", "1.1.1.1")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = [resolver_ip]

    servfail_with_validation = False
    try:
        resolver.resolve(domain, "CAA")
    except dns.resolver.NoAnswer:
        pass
    except dns.resolver.NXDOMAIN:
        pass
    except dns.exception.DNSException as exc:
        if "SERVFAIL" in str(exc) or exc.__class__.__name__ == "NoNameservers":
            servfail_with_validation = True

    ok_with_cd = True
    try:
        query = dns.message.make_query(domain, "CAA", want_dnssec=False)
        query.flags |= dns.flags.CD
        answer = dns.query.udp(query, resolver_ip, timeout=10)
        ok_with_cd = answer.rcode() == 0
    except dns.exception.DNSException:
        ok_with_cd = False

    ds_matches_dnskey = True
    try:
        ds_answer = dns.resolver.resolve(domain, "DS")
        dnskey_answer = dns.resolver.resolve(domain, "DNSKEY")
        digests = {str(r).split()[3] for r in ds_answer}
        computed = set()
        for key in dnskey_answer:
            for algo in (1, 2):
                try:
                    ds = dns.dnssec.make_ds(domain, key, algo)
                    computed.add(str(ds).split()[3])
                except Exception:
                    continue
        ds_matches_dnskey = bool(digests & computed)
    except Exception:
        ds_matches_dnskey = False

    rrsig_expired = False
    try:
        rrsig_answer = dns.resolver.resolve(domain, "DNSKEY", want_dnssec=True)
        now = int(time.time())
        for rrset in rrsig_answer.response.answer:
            for rr in rrset:
                if rr.rdtype == dns.rdatatype.RRSIG and rr.expiration < now:
                    rrsig_expired = True
    except Exception:
        pass

    verdict = diagnose_caa_dnssec_break(
        servfail_with_validation, ok_with_cd, ds_matches_dnskey, rrsig_expired
    )
    log.info("Diagnosis for %s: %s", domain, verdict)

    if verdict == "ok":
        log.info("CAA resolves fine through a validating resolver. Nothing to do.")
        return

    if verdict == "not_dnssec_related":
        log.warning(
            "SERVFAIL does not clear with +cd, so this looks like a dead "
            "nameserver or network issue, not a broken DNSSEC chain."
        )
        return

    log.warning("Broken DNSSEC chain detected: %s", verdict)

    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not zone_id or not api_token:
        log.info(
            "No Cloudflare credentials set. Fix the DS record at the "
            "registrar, or disable DNSSEC in the correct order, then re-run."
        )
        return

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    resp = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dnssec",
        headers=headers, timeout=30,
    )
    resp.raise_for_status()
    status = resp.json()["result"]["status"]
    log.info("Cloudflare zone DNSSEC status is currently: %s", status)

    if dry_run:
        log.info("Dry run: would not change DNSSEC status automatically.")
        return

    disable_dnssec = os.environ.get("DISABLE_DNSSEC", "false").lower() == "true"
    if disable_dnssec and status == "active":
        log.warning(
            "DISABLE_DNSSEC=true, but the DS record must already be removed "
            "at the registrar and its TTL must have expired before this "
            "runs, otherwise this recreates the exact SERVFAIL problem."
        )
        patch = requests.patch(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dnssec",
            headers=headers, json={"status": "disabled"}, timeout=30,
        )
        patch.raise_for_status()
        log.info("Requested Cloudflare to disable DNSSEC for this zone.")
    else:
        log.info(
            "Updating the DS record itself is a registrar action outside "
            "the Cloudflare DNS records API. Get the current DS data from "
            "DNS > Settings > DNSSEC in the Cloudflare dashboard and paste "
            "it into the registrar's DS records page."
        )


if __name__ == "__main__":
    run()
