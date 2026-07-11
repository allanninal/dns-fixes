# Duplicate record write rejected by provider API

A script or automation POSTs a new DNS record without first checking whether one already exists at that exact name and type. Cloudflare rejects the create with error 81057, "The record already exists," for a same-type clash, or error 81053, "An A, AAAA, or CNAME record with that host already exists," when a CNAME conflicts with any other record type at the same name. The fix is reconciliation: list current state, diff against desired state, and only create when absent or update in place when present, instead of always issuing a create.

Full write-up with diagrams: https://www.allanninal.dev/dns/duplicate-record-write-conflict/

## What this does

- Lists the DNS record(s) at an exact name and type through the Cloudflare API before writing anything.
- Runs a pure, I/O-free decision function, `plan_dns_write` (Python) / `planDnsWrite` (Node), that compares what exists against the desired record and returns `create`, `noop`, or `update` with only the changed fields.
- If Cloudflare credentials are set, applies the plan: creates the record when nothing exists, PATCHes just the changed fields when it already exists but differs, or does nothing when it already matches.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="app.example.com"
export DNS_RECORD_TYPE="A"
export DNS_RECORD_CONTENT="203.0.113.10"
export DNS_RECORD_TTL="300"
export DNS_RECORD_PROXIED="false"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python duplicate_record_write_conflict.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="app.example.com"
export DNS_RECORD_TYPE="A"
export DNS_RECORD_CONTENT="203.0.113.10"
export DNS_RECORD_TTL="300"
export DNS_RECORD_PROXIED="false"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node duplicate-record-write-conflict.js
```

## Test

The pure decision function, `plan_dns_write` (Python) / `planDnsWrite` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
