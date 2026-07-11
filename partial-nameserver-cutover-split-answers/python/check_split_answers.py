"""Find a partial nameserver cutover: query every authoritative nameserver
for a domain directly and flag any one whose records disagree with the rest.
Optionally push missing records to the new provider through the Cloudflare API.

Env vars:
    DNS_DOMAIN              domain to check, e.g. "example.com"
    CLOUDFLARE_API_TOKEN    only needed for the repair path
    CLOUDFLARE_ZONE_ID      only needed for the repair path
    DRY_RUN                 defaults to "true"; set to "false" to let it write

Safe to run again and again. Read-only unless DRY_RUN is turned off.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("check_split_answers")

RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT"]


def diff_nameserver_answers(ns_records):
    """
    ns_records: mapping of nameserver_hostname -> {record_type: sorted list of rdata strings}
       e.g. {"ns1.oldhost.com": {"A": ["203.0.113.5"], "TXT": ["v=spf1 ... ~all"]},
             "lena.ns.cloudflare.com": {"A": ["198.51.100.9"], "TXT": ["v=spf1 ... ~all"]}}
    Returns: mapping of record_type -> list of nameserver hostnames that disagree with the
             majority answer for that type (empty dict/list if all nameservers agree).
    Pure/I-O free: takes pre-fetched data in, returns a diff report out; no network calls inside.
    """
    disagreements = {}
    hosts = list(ns_records.keys())
    if len(hosts) < 2:
        return disagreements

    for rtype in RECORD_TYPES:
        answers = {host: tuple(ns_records[host].get(rtype, [])) for host in hosts}
        counts = {}
        for value in answers.values():
            counts[value] = counts.get(value, 0) + 1
        if len(counts) <= 1:
            continue  # every nameserver agrees for this record type
        majority_value = max(counts, key=counts.get)
        outliers = [host for host, value in answers.items() if value != majority_value]
        if outliers:
            disagreements[rtype] = sorted(outliers)
    return disagreements


def run():
    import dns.resolver  # dnspython, imported lazily so the pure function above needs no network
    import requests

    domain = os.environ["DNS_DOMAIN"]
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"
    cf_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    cf_zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")

    log.info("Resolving nameservers for %s", domain)
    ns_hosts = sorted(str(r.target).rstrip(".") for r in dns.resolver.resolve(domain, "NS"))
    log.info("Found %d nameserver(s): %s", len(ns_hosts), ", ".join(ns_hosts))

    ns_records = {}
    for host in ns_hosts:
        resolver = dns.resolver.Resolver(configure=False)
        try:
            ns_ip = str(dns.resolver.resolve(host, "A")[0])
        except Exception as exc:
            log.warning("Could not resolve nameserver %s: %s", host, exc)
            continue
        resolver.nameservers = [ns_ip]
        records = {}
        for rtype in RECORD_TYPES:
            try:
                answer = resolver.resolve(domain, rtype)
                records[rtype] = sorted(str(rr).strip('"') for rr in answer)
            except Exception:
                records[rtype] = []
        ns_records[host] = records

    disagreements = diff_nameserver_answers(ns_records)
    if not disagreements:
        log.info("All nameservers agree. No split detected.")
        return

    for rtype, outliers in disagreements.items():
        log.warning("Record type %s disagrees on: %s", rtype, ", ".join(outliers))

    if dry_run or not (cf_token and cf_zone_id):
        log.info("Dry run (or missing Cloudflare credentials): not writing any records.")
        return

    # Best effort repair: copy the majority answer for each mismatched type
    # into the new provider's zone through the Cloudflare API.
    headers = {"Authorization": f"Bearer {cf_token}", "Content-Type": "application/json"}
    for rtype in disagreements:
        majority_host = next(h for h in ns_hosts if h not in disagreements[rtype])
        values = ns_records[majority_host].get(rtype, [])
        for value in values:
            log.info("Would create/update %s record %s -> %s at Cloudflare", rtype, domain, value)
            requests.post(
                f"https://api.cloudflare.com/client/v4/zones/{cf_zone_id}/dns_records",
                json={"type": rtype, "name": domain, "content": value, "ttl": 300},
                headers=headers, timeout=30,
            ).raise_for_status()
    log.info("Repair pushed. Remember: removing the old nameservers is a registrar action, not covered here.")


if __name__ == "__main__":
    run()
