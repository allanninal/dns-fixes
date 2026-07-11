# Wildcard record points at a deprovisioned service

A wildcard DNS record (`*.example.com CNAME some-app.herokudns.com`) answers for every possible subdomain, including ones nobody has claimed yet. If the target app, bucket, or CDN endpoint was later deleted, an attacker can register that same free-tier name on the provider and take over any unclaimed subdomain of the zone, complete with a trusted TLS certificate. The fix is to delete the wildcard if it is no longer needed, or repoint it at an origin you control that answers unknown hostnames with a plain 404, plus a CAA record as defense in depth.

Full write-up with diagrams: https://www.allanninal.dev/dns/wildcard-pointing-at-deprovisioned-service/

## What this does

- Lists every CNAME record in the zone via the Cloudflare API.
- For each wildcard record (name starting with `*`), resolves the CNAME target and classifies it as `OK`, `NXDOMAIN`, or `SERVFAIL`.
- Flags the record as dangling using a pure, I/O-free decision function, `is_dangling_wildcard` (Python) / `isDanglingWildcard` (Node), which also checks the target's HTTP response against a set of known "unclaimed resource" fingerprints from the can-i-take-over-xyz list.
- If a wildcard is dangling and Cloudflare credentials are set, deletes the record through the Cloudflare API.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to "false" to actually delete the record

python dangling_wildcard.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to "false" to actually delete the record

node dangling-wildcard.js
```

## Test

The pure decision function, `is_dangling_wildcard` (Python) / `isDanglingWildcard` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
