# Duplicate SPF TXT records on one domain

A domain ends up with two separate TXT records that both start with `v=spf1`, often because a new mail tool's setup wizard added its own SPF record instead of appending to the existing one, or a migration left an old record behind. RFC 7208 allows exactly one SPF record per domain, so a resolver that finds two must return permerror instead of guessing which one is right, and that can break SPF for every legitimate sender on the domain.

Full write-up with diagrams: https://www.allanninal.dev/dns/duplicate-spf-records/

## What this does

- Queries the domain's TXT records and counts how many strings start with `v=spf1`.
- Runs a pure, I/O-free decision function, `merge_spf_records` (Python) / `mergeSpfRecords` (Node), that folds every mechanism from all the SPF strings into one new record, de-duplicated, keeping the strictest `all` qualifier found.
- If more than one SPF record is found and Cloudflare credentials are set, repairs the zone by deleting every existing `v=spf1` TXT record and publishing the single merged one.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python duplicate_spf_records.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node duplicate-spf-records.js
```

## Test

The pure decision function, `merge_spf_records` (Python) / `mergeSpfRecords` (Node), is tested with plain string list fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
