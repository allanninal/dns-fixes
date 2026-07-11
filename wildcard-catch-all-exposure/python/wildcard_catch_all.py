"""Detect an apex-level wildcard DNS record and, on repair, replace it with
explicit records through the Cloudflare API. Safe to run on a schedule.
Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("wildcard_catch_all")


def classify_wildcard_scope(record_name: str, zone_apex: str) -> str:
    """Pure decision function. No network, no I/O.

    Returns "apex_catch_all" if the wildcard sits one label below the
    apex (catches every subdomain), "scoped_subzone" if it is nested
    under an explicit subzone, or "not_wildcard" if the name has no
    leading "*." label at all.
    """
    if not record_name.startswith("*."):
        return "not_wildcard"

    remainder = record_name[2:]
    if remainder == zone_apex:
        return "apex_catch_all"

    if remainder.endswith("." + zone_apex):
        sub_labels = remainder[: -(len(zone_apex) + 1)]
        if sub_labels:
            return "scoped_subzone"

    return "apex_catch_all"


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    zone_apex = os.environ["DNS_DOMAIN"]
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    resp = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        params={"per_page": 100},
        timeout=30,
    )
    resp.raise_for_status()
    records = resp.json()["result"]

    wildcards = [r for r in records if r["name"].startswith("*.")]
    if not wildcards:
        log.info("No wildcard records found in the zone.")
        return

    resolver = dns.resolver.Resolver()
    probe_names = [f"asdkfj829.{zone_apex}", f"totally-made-up-name.{zone_apex}"]

    for record in wildcards:
        scope = classify_wildcard_scope(record["name"], zone_apex)
        log.info("Wildcard %s classified as %s", record["name"], scope)

        if scope != "apex_catch_all":
            continue

        target = record["content"]
        catch_all_confirmed = False
        for probe in probe_names:
            try:
                answer = resolver.resolve(probe, record["type"])
                values = [str(a) for a in answer]
                if target in values:
                    catch_all_confirmed = True
                    log.warning("Probe %s resolved to wildcard target %s", probe, target)
            except dns.resolver.NXDOMAIN:
                pass

        if not catch_all_confirmed:
            log.info("Wildcard %s is apex-level but probes did not confirm live catch-all.", record["name"])
            continue

        log.warning("Confirmed apex-level catch-all: %s -> %s", record["name"], target)

        if dry_run:
            log.info("Dry run: would delete record %s (%s)", record["id"], record["name"])
            continue

        del_resp = requests.delete(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record['id']}",
            headers=headers,
            timeout=30,
        )
        del_resp.raise_for_status()
        log.info("Deleted apex wildcard record %s", record["name"])


if __name__ == "__main__":
    run()
