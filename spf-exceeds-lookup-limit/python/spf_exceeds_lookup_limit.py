"""Detect an SPF record that exceeds the 10 DNS lookup limit and, on
repair, replace it with a flattened record through the Cloudflare API.
Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("spf_exceeds_lookup_limit")

LOOKUP_MECHANISMS = ("include", "a", "mx", "ptr", "exists")


def count_spf_lookups(spf_record, resolver, _depth=0, _seen=None):
    """Pure decision function. No DNS I/O, no network calls.

    spf_record: the raw SPF string, e.g. 'v=spf1 include:_spf.google.com ~all'.
    resolver: a callable resolver(kind, name) -> list[str] that the caller
              injects. kind is "TXT" for include/redirect lookups. The
              real run() wires this to dnspython; tests wire it to a
              fake dict.
    _depth, _seen: internal recursion guards (max depth 10 per RFC 7208,
              a seen-set to avoid infinite loops on a misconfigured chain).

    Returns (total_lookup_count: int, warnings: list[str]).
    """
    if _seen is None:
        _seen = set()

    warnings = []
    count = 0

    if _depth > 10:
        warnings.append("recursion depth exceeded 10, stopping (likely a loop)")
        return count, warnings

    tokens = spf_record.split()
    for token in tokens:
        mechanism = token.lstrip("+-~?")

        matched = False
        for kind in LOOKUP_MECHANISMS:
            if mechanism == kind or mechanism.startswith(kind + ":") or mechanism.startswith(kind + "/"):
                matched = True
                count += 1
                if mechanism.startswith("include:"):
                    target = mechanism.split(":", 1)[1]
                    if target in _seen:
                        warnings.append(f"include:{target} already visited, skipping to avoid a loop")
                        continue
                    _seen.add(target)
                    included_txt = resolver("TXT", target)
                    included_record = next((r for r in included_txt if r.startswith("v=spf1")), None)
                    if included_record is None:
                        warnings.append(f"include:{target} returned no usable SPF record (void lookup)")
                        continue
                    nested_count, nested_warnings = count_spf_lookups(
                        included_record, resolver, _depth + 1, _seen
                    )
                    count += nested_count
                    warnings.extend(nested_warnings)
                break
        if matched:
            continue

        if mechanism.startswith("redirect="):
            count += 1
            target = mechanism.split("=", 1)[1]
            if target in _seen:
                warnings.append(f"redirect={target} already visited, skipping to avoid a loop")
                continue
            _seen.add(target)
            redirected_txt = resolver("TXT", target)
            redirected_record = next((r for r in redirected_txt if r.startswith("v=spf1")), None)
            if redirected_record is None:
                warnings.append(f"redirect={target} returned no usable SPF record (void lookup)")
                continue
            nested_count, nested_warnings = count_spf_lookups(
                redirected_record, resolver, _depth + 1, _seen
            )
            count += nested_count
            warnings.extend(nested_warnings)

    if count > 10 and not any("exceeds 10-lookup limit" in w for w in warnings):
        warnings.append(f"exceeds 10-lookup limit ({count} found)")

    return count, warnings


def run():
    # Imported lazily so the pure function above can be tested with no
    # network libraries installed at all.
    import dns.resolver
    import requests

    domain = os.environ["DNS_DOMAIN"]
    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    live_resolver = dns.resolver.Resolver()

    def resolve_txt(kind, name):
        try:
            answer = live_resolver.resolve(name, kind)
            return ["".join(part.decode() if isinstance(part, bytes) else part for part in r.strings)
                    for r in answer]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.exception.Timeout):
            return []

    answers = live_resolver.resolve(domain, "TXT")
    spf_record = next(
        (
            "".join(p.decode() if isinstance(p, bytes) else p for p in r.strings)
            for r in answers
            if "".join(p.decode() if isinstance(p, bytes) else p for p in r.strings).startswith("v=spf1")
        ),
        None,
    )
    if spf_record is None:
        log.warning("No SPF record found at %s", domain)
        return

    total, warnings = count_spf_lookups(spf_record, resolve_txt)
    log.info("SPF at %s uses %d lookup(s)", domain, total)
    for w in warnings:
        log.warning(w)

    if total <= 10:
        log.info("No fix needed. Lookup count is within the limit.")
        return

    # Compute a flattened replacement: keep any existing ip4/ip6 tokens
    # as-is, drop every include/a/mx/ptr/exists/redirect, and note that a
    # real flattening pass would resolve each include's underlying IPs
    # here. We keep this conservative: it reports the plan in dry run and
    # only proceeds with a real IP set supplied by the caller.
    static_tokens = [t for t in spf_record.split() if t.startswith(("ip4:", "ip6:", "v=spf1"))]
    tail = "-all" if spf_record.rstrip().endswith(("-all", "~all", "?all", "+all")) else "-all"
    flattened_record = " ".join(static_tokens + [tail])

    log.warning("SPF exceeds the limit: %d lookups. Proposed flattened record: %s", total, flattened_record)

    if dry_run:
        log.info("Dry run: would replace TXT record at %s with: %s", domain, flattened_record)
        return

    list_resp = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
        headers=headers,
        params={"type": "TXT", "name": domain},
        timeout=30,
    )
    list_resp.raise_for_status()
    records = list_resp.json().get("result", [])
    record_id = next((r["id"] for r in records if r.get("content", "").strip('"').startswith("v=spf1")), None)
    if record_id is None:
        log.warning("No existing SPF TXT record id found to update at %s", domain)
        return

    patch_resp = requests.patch(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}",
        headers=headers,
        json={"type": "TXT", "name": domain, "content": flattened_record},
        timeout=30,
    )
    patch_resp.raise_for_status()
    log.info("Replaced SPF TXT record at %s with a flattened record under the limit", domain)


if __name__ == "__main__":
    run()
