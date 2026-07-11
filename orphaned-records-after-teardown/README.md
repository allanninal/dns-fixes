# Orphaned DNS records left after service teardown

A subdomain still points at a cloud resource, load balancer, or SaaS app that was decommissioned long ago. The DNS record is a separate object in the zone that nobody is forced to delete when the underlying resource goes away, so it keeps resolving to something unused, unassigned, or reclaimable by a stranger. This script lists a zone's CNAME, A, and AAAA records, cross-checks each target against a live infrastructure inventory, and, when told to, deletes the confirmed orphaned records through the Cloudflare API.

**Full guide with diagrams:** https://www.allanninal.dev/dns/orphaned-records-after-teardown/

## What this does

- Lists every CNAME, A, and AAAA record in the zone through the Cloudflare API.
- Runs a pure, I/O-free decision function, `classify_record` (Python) / `classifyRecord` (Node), that compares each record's target against a live infrastructure inventory and a set of known "unclaimed provider" fingerprints.
- Flags each record as `active`, `orphaned`, or `needs_manual_review`.
- If a record is confirmed orphaned and Cloudflare credentials are set, deletes it.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export LIVE_INVENTORY="app-v2.herokuapp.com,203.0.113.10"  # your current infrastructure
export DRY_RUN="true"                      # set to "false" to actually write

python orphaned_records.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export LIVE_INVENTORY="app-v2.herokuapp.com,203.0.113.10"  # your current infrastructure
export DRY_RUN="true"                      # set to "false" to actually write

node orphaned-records.js
```

## Test

The pure decision function, `classify_record` (Python) / `classifyRecord` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
