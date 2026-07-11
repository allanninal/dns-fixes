"""Detect and repair a false-positive duplicate record conflict caused by
a dedup/reconciler check that only keys on (name, type) instead of the
provider's real identity key of (name, type, set_identifier).

Safe by default. Set DRY_RUN=false to let it write.

Env vars:
  DNS_DOMAIN               the name to check, e.g. "acme.example.com"
  CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
  CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
  DRY_RUN                  default "true"; set to "false" to actually write
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("false_positive_duplicate_detection")

DNS_DOMAIN = os.environ.get("DNS_DOMAIN", "example.com")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CF_API = "https://api.cloudflare.com/client/v4"


def is_duplicate_record(existing: dict, candidate: dict) -> bool:
    """Pure decision function. No I/O.

    existing/candidate keys: name (str, lowercased FQDN), type (str),
    set_identifier (str|None), content (str, e.g. IP or target).
    Returns True only if the records are truly the same record set.
    Route53-style: identity key is (name, type, set_identifier).
    Provider-without-set-id (e.g. Cloudflare A/AAAA multivalue): fall back
    to (name, type, content) so distinct values are never merged.
    """
    same_name = existing["name"].rstrip(".").lower() == candidate["name"].rstrip(".").lower()
    same_type = existing["type"].upper() == candidate["type"].upper()
    if not (same_name and same_type):
        return False
    if existing.get("set_identifier") or candidate.get("set_identifier"):
        return existing.get("set_identifier") == candidate.get("set_identifier")
    return existing["content"] == candidate["content"]


def find_real_conflicts(existing_records, intended_records):
    """Given the live zone and the intended record list, return only the
    intended records that are true duplicates of something already live.
    Everything else (a new SetIdentifier, a new value) is not a conflict
    and should be allowed through.
    """
    conflicts = []
    for candidate in intended_records:
        for existing in existing_records:
            if is_duplicate_record(existing, candidate):
                conflicts.append(candidate)
                break
    return conflicts


def list_zone_records(name=None):
    """List DNS records in the Cloudflare zone, optionally filtered by name."""
    import requests

    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    params = {"per_page": 5000}
    if name:
        params["name"] = name
    r = requests.get(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return [
        {
            "name": rec["name"],
            "type": rec["type"],
            "content": rec["content"],
            "set_identifier": None,  # Cloudflare has no SetIdentifier concept
            "id": rec["id"],
        }
        for rec in r.json()["result"]
    ]

    # For Route 53 instead, lazily import boto3 and use:
    #   import boto3
    #   client = boto3.client("route53")
    #   resp = client.list_resource_record_sets(HostedZoneId=zone_id)
    #   for rrset in resp["ResourceRecordSets"]:
    #       set_identifier = rrset.get("SetIdentifier")
    #       ...


def apply_record(candidate):
    """Apply a genuinely new/changed record through the Cloudflare API
    (POST for a new record, PUT for an update to an existing one).
    """
    import requests

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json",
    }
    body = {
        "type": candidate["type"],
        "name": candidate["name"],
        "content": candidate["content"],
        "ttl": candidate.get("ttl", 300),
    }
    if DRY_RUN:
        log.info("[dry run] would apply record %s", body)
        return
    requests.post(
        f"{CF_API}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        headers=headers, json=body, timeout=30,
    ).raise_for_status()
    log.info("Applied record %s", body)

    # For Route 53 instead, this would call:
    #   client.change_resource_record_sets(
    #       HostedZoneId=zone_id,
    #       ChangeBatch={"Changes": [{"Action": "UPSERT", "ResourceRecordSet": rrset}]},
    #   )


def run():
    if not (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID):
        log.warning("No Cloudflare credentials set. Nothing to check for %s.", DNS_DOMAIN)
        return

    existing_records = list_zone_records(DNS_DOMAIN)

    # The "intended" list normally comes from source control (Terraform
    # state, a records.yaml file, and so on). This is a stand-in example
    # of a second weighted record that a bad (name, type)-only dedup
    # check would have blocked.
    intended_records = [
        {
            "name": DNS_DOMAIN,
            "type": "A",
            "set_identifier": "us-east-secondary",
            "content": "192.0.2.11",
            "ttl": 60,
        },
    ]

    real_conflicts = find_real_conflicts(existing_records, intended_records)
    false_positives = [r for r in intended_records if r not in real_conflicts]

    if false_positives:
        log.info(
            "%d record(s) were not real duplicates and will be applied.",
            len(false_positives),
        )
    for record in false_positives:
        apply_record(record)

    if real_conflicts:
        log.warning(
            "%d record(s) are true duplicates (same name, type, and "
            "set_identifier or content) and were skipped.",
            len(real_conflicts),
        )

    log.info("Done.")


if __name__ == "__main__":
    run()
