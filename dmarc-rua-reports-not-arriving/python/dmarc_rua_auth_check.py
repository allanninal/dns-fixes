"""Detect a missing DMARC third party report authorization record and
repair it via Cloudflare. Safe to run on a schedule. Stays in dry run
until DRY_RUN=false.

Env vars:
  DNS_DOMAIN              policy domain that publishes the DMARC record (required)
  CLOUDFLARE_API_TOKEN    Cloudflare API token with DNS edit access (required for repair)
  CLOUDFLARE_ZONE_ID      Cloudflare zone id that hosts the rua destination domain (required for repair)
  DRY_RUN                 "true" (default) or "false"
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dmarc_rua_auth_check")


def parse_rua_domain(dmarc_record_value: str):
    """Pure parser. No network, no I/O.

    Pulls the domain part out of the rua mailto address in a DMARC
    record string. Returns None if there is no rua tag.
    """
    for part in dmarc_record_value.split(";"):
        part = part.strip()
        if not part.lower().startswith("rua="):
            continue
        value = part.split("=", 1)[1]
        # rua can list more than one address, comma separated. Use the first.
        first = value.split(",")[0].strip()
        if first.lower().startswith("mailto:"):
            first = first[len("mailto:"):]
        if "@" in first:
            return first.split("@", 1)[1].strip()
    return None


def needs_third_party_auth(policy_domain: str, rua_domain: str, auth_txt_records: list, wildcard_txt_records: list) -> bool:
    """
    policy_domain: domain publishing the DMARC record (e.g. 'example.com')
    rua_domain: domain part of the rua mailto: address (e.g. 'reports.example.net')
    auth_txt_records: TXT record values found at f'{policy_domain}._report._dmarc.{rua_domain}'
    wildcard_txt_records: TXT record values found at f'*._report._dmarc.{rua_domain}'
    Returns True if authorization is required (domains differ) and missing/invalid in both the
    specific and wildcard record, meaning reports will be silently dropped.
    """
    if policy_domain == rua_domain or rua_domain.endswith("." + policy_domain):
        return False  # same-domain rua, no third-party auth needed per RFC 7489 7.1
    has_specific_auth = any("v=dmarc1" in r.lower().replace(" ", "") for r in auth_txt_records)
    has_wildcard_auth = any("v=dmarc1" in r.lower().replace(" ", "") for r in wildcard_txt_records)
    return not (has_specific_auth or has_wildcard_auth)


def run():
    # Imported lazily so the pure functions above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    policy_domain = os.environ["DNS_DOMAIN"]
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    resolver = dns.resolver.Resolver()

    def txt_values(name):
        try:
            answer = resolver.resolve(name, "TXT")
            return ["".join(part.decode() if isinstance(part, bytes) else part for part in rdata.strings)
                    for rdata in answer]
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return []

    dmarc_name = f"_dmarc.{policy_domain}"
    dmarc_records = txt_values(dmarc_name)
    if not dmarc_records:
        log.warning("No DMARC record found at %s", dmarc_name)
        return

    rua_domain = parse_rua_domain(dmarc_records[0])
    if rua_domain is None:
        log.warning("No rua tag found in DMARC record at %s", dmarc_name)
        return

    log.info("Policy domain %s reports to rua domain %s", policy_domain, rua_domain)

    auth_name = f"{policy_domain}._report._dmarc.{rua_domain}"
    wildcard_name = f"*._report._dmarc.{rua_domain}"
    auth_records = txt_values(auth_name)
    wildcard_records = txt_values(wildcard_name)

    if not needs_third_party_auth(policy_domain, rua_domain, auth_records, wildcard_records):
        log.info("Authorization already satisfied, or same-domain rua. Nothing to do.")
        return

    log.warning("Missing authorization record at %s. Reports are being silently dropped.", auth_name)
    log.info("%s create TXT %s = v=DMARC1", "Would" if dry_run else "Will", auth_name)
    if dry_run:
        return

    if not zone_id or not api_token:
        log.error("CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are required to repair.")
        return

    resp = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        json={"type": "TXT", "name": auth_name, "content": "v=DMARC1", "ttl": 3600},
        timeout=30,
    )
    resp.raise_for_status()
    log.info("Created authorization record at %s", auth_name)


if __name__ == "__main__":
    run()
