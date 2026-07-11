# Stale DS records left behind after key rollover

During a DNSSEC key rollover, a new DS record gets published at the registrar but the old one never gets deleted. The parent zone keeps serving both DS entries forever, so a validating resolver sees a DS key tag with no matching, currently-signing DNSKEY in the child zone and cannot build a clean chain of trust. Resolution fails with SERVFAIL or is marked bogus, even though the "current" key is otherwise fine.

Full write-up with diagrams: https://www.allanninal.dev/dns/stale-ds-records-orphaned/

## What this does

- Queries the DS RRset the parent/registry is publishing for a domain.
- Queries the child zone's live DNSKEYs and computes the DS digest each one would produce.
- Flags any published DS record whose (key tag, algorithm, digest) has no matching computed DNSKEY digest, using a pure, I/O-free decision function.
- If Cloudflare credentials are set, refreshes Cloudflare-side DNSSEC state as part of the repair. Where the DS lives purely at a third-party registrar, removing the stale DS record itself falls back to a manual registrar-portal action.
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

python stale_ds_records.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node stale-ds-records.js
```

## Test

The pure decision function, `find_stale_ds` (Python) / `findStaleDs` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
