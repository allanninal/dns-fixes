"""Walk a CNAME chain hop by hop, find the dangling intermediate hop, and
repair the record you control via Cloudflare. Safe to run on a schedule.
Stays in dry run until DRY_RUN=false.

Env vars:
  DNS_DOMAIN            the top-level hostname to walk, e.g. app.example.com
  MAX_DEPTH             max hops to follow before giving up (default 10)
  DRY_RUN               "true" (default) or "false"
  CLOUDFLARE_API_TOKEN  Cloudflare API token with DNS edit permission
  CLOUDFLARE_ZONE_ID    the zone id that owns the record to repair
  REPLACEMENT_TARGET    if set, PATCH the owned record to this target;
                        if unset, DELETE the owned record instead
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dangling_cname_chain")


def find_dangling_hop(chain: list, max_depth: int = 10):
    """Pure decision logic, no I/O. The DNS resolution itself happens in run().

    Each item in chain is a dict:
      {"hostname": str, "is_cname": bool, "target": str | None,
       "resolved_status": "OK" | "NXDOMAIN" | "SERVFAIL"}

    Returns the first dict in the chain (scanning every hop, not just the
    first) whose resolved_status is NXDOMAIN or SERVFAIL, or None if the
    whole chain resolves cleanly to a terminal A/AAAA record within
    max_depth hops. Returns a chain-too-long marker if the chain exceeds
    max_depth without terminating (possible loop).
    """
    if len(chain) > max_depth:
        return {"hostname": chain[max_depth]["hostname"], "reason": "chain-too-long"}
    for hop in chain:
        if hop["resolved_status"] in ("NXDOMAIN", "SERVFAIL"):
            return hop
    return None


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import dns.rdatatype
    import requests

    domain = os.environ["DNS_DOMAIN"]
    max_depth = int(os.environ.get("MAX_DEPTH", "10"))
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    resolver = dns.resolver.Resolver()
    chain = []
    current = domain

    for _ in range(max_depth + 1):
        try:
            answer = resolver.resolve(current, "CNAME")
            target = str(answer[0].target).rstrip(".")
            chain.append({"hostname": current, "is_cname": True, "target": target,
                          "resolved_status": "OK"})
            current = target
            continue
        except dns.resolver.NXDOMAIN:
            chain.append({"hostname": current, "is_cname": False, "target": None,
                          "resolved_status": "NXDOMAIN"})
            break
        except dns.resolver.NoAnswer:
            # No CNAME here. Either it is a terminal A/AAAA record (OK) or
            # nothing resolves at all for this name (treat as SERVFAIL-like).
            try:
                resolver.resolve(current, "A")
                chain.append({"hostname": current, "is_cname": False, "target": None,
                              "resolved_status": "OK"})
            except Exception:
                chain.append({"hostname": current, "is_cname": False, "target": None,
                              "resolved_status": "SERVFAIL"})
            break
        except Exception:
            chain.append({"hostname": current, "is_cname": False, "target": None,
                          "resolved_status": "SERVFAIL"})
            break

    dangling = find_dangling_hop(chain, max_depth=max_depth)

    if dangling is None:
        log.info("Chain for %s resolves cleanly, %d hop(s), no dangling hop found.",
                  domain, len(chain))
        return

    if dangling.get("reason") == "chain-too-long":
        log.warning("Chain for %s exceeded max depth %d, possible loop.", domain, max_depth)
        return

    log.warning("Dangling hop found: %s (status=%s)", dangling["hostname"], dangling["resolved_status"])

    # Find the record in our own zone whose target is the hop just before the
    # dangling one, since that is the record we can actually repair.
    broken_index = chain.index(dangling)
    if broken_index == 0:
        log.warning("The dangling hop is the top-level name itself. Nothing upstream to repoint.")
        return

    owned_record_name = chain[broken_index - 1]["hostname"]
    log.warning("Record to repair: %s (currently points at %s)", owned_record_name, dangling["hostname"])

    if not zone_id or not api_token:
        log.info("No Cloudflare credentials set, skipping repair. %s would be repointed or deleted.",
                  owned_record_name)
        return

    replacement_target = os.environ.get("REPLACEMENT_TARGET")
    log.info("%s record %s to %s.",
             "Would repoint" if dry_run else "Repointing", owned_record_name,
             replacement_target or "(delete, no replacement target set)")

    if dry_run:
        return

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"

    lookup = requests.get(base, headers=headers, params={"name": owned_record_name}, timeout=30)
    lookup.raise_for_status()
    records = lookup.json().get("result", [])
    if not records:
        log.warning("Could not find a Cloudflare DNS record named %s to repair.", owned_record_name)
        return
    record_id = records[0]["id"]

    if replacement_target:
        resp = requests.patch(f"{base}/{record_id}", headers=headers,
                               json={"content": replacement_target}, timeout=30)
    else:
        resp = requests.delete(f"{base}/{record_id}", headers=headers, timeout=30)
    resp.raise_for_status()
    log.info("Repaired %s.", owned_record_name)


if __name__ == "__main__":
    run()
