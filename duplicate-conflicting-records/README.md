# Duplicate or conflicting records for the same name

A single hostname ends up with two records that fight each other, most often a CNAME record next to an A/AAAA/other record type at the exact same name, or a stale leftover A record next to the current, correct one. RFC 1034 forbids a CNAME from coexisting with any other record type at the same node, and a duplicate A record is only a problem when one of the IPs is stale rather than part of an intentional round robin set.

Full write-up with diagrams: https://www.allanninal.dev/dns/duplicate-conflicting-records/

## What this does

- Lists the DNS records at a name through the Cloudflare API.
- Groups them by exact name and runs a pure, I/O-free decision function that flags either a CNAME coexisting with another type, or duplicate A/AAAA records where at least one IP is not on an expected list.
- If a conflict is found and Cloudflare credentials are set, repairs it by deleting the record(s) that do not belong, keeping only the correct one.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export EXPECTED_IPS="203.0.113.10,203.0.113.11"  # optional, for round robin checks
export DRY_RUN="true"                      # set to "false" to actually write

python duplicate_conflicting_records.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export EXPECTED_IPS="203.0.113.10,203.0.113.11"  # optional, for round robin checks
export DRY_RUN="true"                      # set to "false" to actually write

node duplicate-conflicting-records.js
```

## Test

The pure decision function, `detect_duplicate_conflict` (Python) / `detectDuplicateConflict` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
