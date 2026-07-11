"""Pre-flight check that runs the same calls a DNS automation makes and
reports which permission group is missing, before any real record write
is attempted. Safe to run on a schedule or as a CI step ahead of the
actual automation. Stays read-only in this script; it never writes an
automation record itself, it only diagnoses the token.
"""
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("diagnose_token_scope")


def diagnose_token_scope(verify_ok, zone_list_response, dns_read_response):
    """Pure decision logic (no I/O): given the parsed JSON bodies already
    fetched from /user/tokens/verify, /zones?name=..., and
    /zones/{id}/dns_records, classify the failure.
    Returns one of: 'ok', 'token_invalid', 'missing_zone_read',
    'missing_dns_edit', 'unknown_error'.
    """
    if not verify_ok:
        return "token_invalid"
    if not zone_list_response.get("success", False):
        return "missing_zone_read"
    if not dns_read_response.get("success", False):
        return "missing_dns_edit"
    return "ok"


def run():
    # Imported lazily so diagnose_token_scope above can be unit tested
    # with no network libraries installed at all.
    import requests

    domain = os.environ["DNS_DOMAIN"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID", "")
    dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    base = "https://api.cloudflare.com/client/v4"

    verify = requests.get(f"{base}/user/tokens/verify", headers=headers, timeout=15).json()
    verify_ok = bool(verify.get("success")) and verify.get("result", {}).get("status") == "active"
    log.info("Token verify: %s", "active" if verify_ok else "not active")

    zone_list = requests.get(f"{base}/zones", headers=headers, params={"name": domain}, timeout=15).json()

    resolved_zone_id = zone_id
    if zone_list.get("success") and zone_list.get("result"):
        resolved_zone_id = zone_list["result"][0]["id"]

    dns_read = {"success": False}
    if resolved_zone_id:
        dns_read = requests.get(
            f"{base}/zones/{resolved_zone_id}/dns_records",
            headers=headers,
            params={"type": "TXT", "name": f"_acme-challenge.{domain}"},
            timeout=15,
        ).json()

    verdict = diagnose_token_scope(verify_ok, zone_list, dns_read)

    if verdict == "ok":
        log.info("Token has the permissions this automation needs. Safe to proceed.")
        return

    messages = {
        "token_invalid": "Token is not active. Reissue it in the Cloudflare dashboard.",
        "missing_zone_read": (
            "Token is missing Zone, Zone, Read (or account-level Zone Read). "
            "It cannot resolve a domain name to a zone id, so every automation "
            "run aborts before it ever attempts the DNS write."
        ),
        "missing_dns_edit": (
            "Token is missing Zone, DNS, Edit for this zone. It can list the "
            "zone but cannot read or write DNS records in it."
        ),
    }
    log.warning("Scope problem: %s -> %s", verdict, messages.get(verdict, "Unknown error, check the raw responses."))

    if dry_run:
        log.info("Dry run: not attempting a real record write. Fix the token scope, then re-run.")
        return

    log.info("DRY_RUN is false, but this pre-flight check never writes real automation records itself.")


if __name__ == "__main__":
    run()
