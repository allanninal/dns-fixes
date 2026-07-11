# DNS-managed record overwritten without an ownership check

A reconciler like ExternalDNS or a Terraform Cloudflare provider manages a
zone by diffing a desired state against the live records and writing
whatever is different. If it never checks an ownership marker first, it can
overwrite or delete a record created by a human, another team's automation,
or a different tool entirely. This script fetches the live record and its
ownership comment from Cloudflare, decides with a pure function whether a
write is safe, and only proceeds to create or update when the marker matches
the reconciler's own owner id. Everything else is logged as a skipped
conflict instead of being overwritten.

Guide: https://www.allanninal.dev/dns/unowned-record-overwritten/

## Run it

### Python

```bash
cd python
pip install requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DNS_OWNER_ID="team-a"
export DRY_RUN="true"   # set to false to actually create or update records
python check_record_ownership.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DNS_OWNER_ID="team-a"
export DRY_RUN="true"   # set to false to actually create or update records
node check-record-ownership.js
```

## Test

The pure decision function `decide_action` / `decideAction` takes plain
dicts and strings. No network, no Cloudflare credentials required to run
the tests.

```bash
# Python
cd python
pytest test_unowned_decision.py

# Node.js
cd node
node --test
```
