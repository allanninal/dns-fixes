"""Detect (and, where safe, repair) a zone lookup failure for an ACME
DNS-01 challenge name. Replicates the label walk with dnspython to find
the true DNS-side apex, then checks whether that exact name is a zone
registered in the Cloudflare account. If they disagree, this reports the
mismatch. If DRY_RUN is false and a usable zone was found, it writes the
_acme-challenge TXT record through the Cloudflare API.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("resolve_acme_zone")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "sub.example.com")
CHALLENGE_VALUE = os.environ.get("CHALLENGE_VALUE", "placeholder-token")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"


def fqdn_labels(fqdn):
    """Split a name into labels, most-specific first, e.g.
    "sub.example.com" -> ["sub", "example", "com"]."""
    return [label for label in fqdn.strip(".").split(".") if label]


def candidate_suffixes(labels):
    """All suffixes of the label list, shortest-label-stripped-first,
    e.g. ["_acme-challenge","sub","example","com"] ->
    ["sub.example.com", "example.com", "com"] (drop the challenge label
    itself, the walk only ever tests real domain suffixes)."""
    suffixes = []
    for i in range(1, len(labels)):
        suffixes.append(".".join(labels[i:]))
    return suffixes


def resolve_zone_for_challenge(fqdn_labels, soa_present_at, api_zone_names):
    """
    fqdn_labels: labels of the challenge name from most-specific to root,
                 e.g. ["_acme-challenge","www","sub","example","com"]
    soa_present_at: maps a candidate zone apex string (e.g. "sub.example.com")
                     to whether a live DNS query returned an authoritative SOA there
    api_zone_names: set of zone names the DNS provider account actually has registered
    Returns the zone apex to write records into, or None if walk and API zone list
    never agree (i.e. the failure this issue describes).
    Pure decision logic: walk suffixes shortest-label-stripped-first, find first
    suffix with soa_present_at[suffix] True, then require that suffix to also be
    in api_zone_names; else return None.
    """
    for suffix in candidate_suffixes(fqdn_labels):
        if soa_present_at.get(suffix):
            return suffix if suffix in api_zone_names else None
    return None


def query_soa_present_at(suffixes):
    """Live DNS side: for each candidate suffix, ask for an SOA record and
    record whether an authoritative answer came back."""
    import dns.resolver
    import dns.exception

    present = {}
    for suffix in suffixes:
        try:
            dns.resolver.resolve(suffix, "SOA")
            present[suffix] = True
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.exception.Timeout):
            present[suffix] = False
        except Exception:
            present[suffix] = False
    return present


def fetch_cloudflare_zone_names(candidate_names):
    """Provider side: ask Cloudflare's zone list for each candidate name and
    collect which ones actually exist in this account."""
    import requests

    found = set()
    for name in candidate_names:
        r = requests.get(
            "https://api.cloudflare.com/client/v4/zones",
            params={"name": name},
            headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
            timeout=15,
        )
        r.raise_for_status()
        for zone in r.json().get("result", []):
            found.add(zone["name"])
    return found


def write_acme_txt_record(zone_id, challenge_fqdn, value):
    """Guarded by DRY_RUN. Writes the _acme-challenge TXT record through
    the Cloudflare DNS API once a usable zone has been confirmed."""
    import requests

    r = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        json={"type": "TXT", "name": challenge_fqdn, "content": value, "ttl": 120},
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def run():
    challenge_fqdn = f"_acme-challenge.{DNS_DOMAIN}"
    labels = fqdn_labels(challenge_fqdn)
    suffixes = candidate_suffixes(labels)

    log.info("Walking labels for %s: candidates %s", challenge_fqdn, suffixes)

    soa_present_at = query_soa_present_at(suffixes)
    api_zone_names = fetch_cloudflare_zone_names(suffixes)

    log.info("SOA present at: %s", {k: v for k, v in soa_present_at.items() if v})
    log.info("Provider account zone names found: %s", sorted(api_zone_names))

    zone = resolve_zone_for_challenge(labels, soa_present_at, api_zone_names)

    if zone is None:
        log.warning(
            "Could not determine the zone for %s. The SOA walk and the provider "
            "account's zone list never agreed on an apex. Check delegation with "
            "dig NS, and confirm which name is actually registered with the "
            "provider API.",
            challenge_fqdn,
        )
        return

    log.info("Resolved zone: %s", zone)

    if DRY_RUN:
        log.info("DRY_RUN is true. Would write TXT record %s in zone %s.", challenge_fqdn, zone)
        return

    if not CLOUDFLARE_ZONE_ID:
        log.warning("DRY_RUN is false but CLOUDFLARE_ZONE_ID is not set. Not writing.")
        return

    write_acme_txt_record(CLOUDFLARE_ZONE_ID, challenge_fqdn, CHALLENGE_VALUE)
    log.info("Wrote TXT record %s in zone %s.", challenge_fqdn, zone)


if __name__ == "__main__":
    run()
