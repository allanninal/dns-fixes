# WHOIS or RDAP change signals possible domain hijack

A domain hijack almost always starts with a quiet edit to the domain's RDAP record before the actual takeover: the transfer lock (`clientTransferProhibited`) disappears, the nameservers switch to servers you did not configure, or the registrant contact changes. These edits usually happen hours to days ahead of an unauthorized transfer or DNS redirect. This script polls RDAP on a schedule, normalizes the fields that matter, and diffs the result against a stored known-good snapshot so the change is caught the same hour it happens. It is diagnostic only: re-locking a domain, resetting registrar credentials, or halting a transfer are registrar and EPP-level actions that cannot be done through the Cloudflare DNS API, so the actual fix is a manual registrar-portal step.

**Full guide with diagrams:** https://www.allanninal.dev/dns/rdap-hijack-signal-monitoring/

## Run it

```bash
export DNS_DOMAIN="example.com"
export DRY_RUN="true"   # this check never writes regardless
export SNAPSHOT_PATH="rdap_snapshot.json"

# Python
pip install requests
python rdap-hijack-signal-monitoring/python/check_rdap_hijack_signal.py

# Node
node rdap-hijack-signal-monitoring/node/check-rdap-hijack-signal.js
```

The first run saves the current RDAP state as the trusted baseline. Every run after that diffs the fresh RDAP record against that baseline and prints a warning for each field that changed: a lost status lock, a nameserver swap, a registrant or registrar handle change, or a moved "last changed" event.

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are accepted for consistency with the other fixes in this repo but are unused, since the Cloudflare DNS API only manages records inside a zone already delegated to it, not registrar-level ownership or lock fields.

## Test

```bash
pytest rdap-hijack-signal-monitoring/python
node --test rdap-hijack-signal-monitoring/node
```
