# Answers differ across public resolvers

DNS "propagation" is not a push. Each recursive resolver independently
caches an answer until its own TTL expires, then asks the authoritative
nameservers again. Right after a record change, some public resolvers
still serve the old cached value while others already return the new one,
so 1.1.1.1, 8.8.8.8, 9.9.9.9, and others can legitimately disagree for up
to one TTL period. This script queries a name against several public
resolvers plus the zone's own authoritative nameservers in parallel,
compares the answers and their reported TTLs, and tells you whether the
mismatch is ordinary propagation lag or a real authoritative mismatch
(a partial rollout at the DNS host). When the cause is a stale long TTL,
it can lower the record's TTL through the Cloudflare API so future
changes converge faster.

Guide: https://www.allanninal.dev/dns/resolver-answer-inconsistency/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export RECORD_TYPE="A"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually lower the record's TTL
python check_resolver_consistency.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export RECORD_TYPE="A"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually lower the record's TTL
node check-resolver-consistency.js
```

## Test

The pure decision function `diagnose_resolver_inconsistency` /
`diagnoseResolverInconsistency` takes the authoritative answer, a map of
resolver answers, a map of resolver TTLs, and the configured TTL, and
returns whether the zone is consistent, which resolvers are stale, the
likely cause, and whether lowering the TTL is recommended. No network, no
DNS library, no Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_resolver_diagnosis.py

# Node.js
cd node
node --test
```
