# Proxied record silently overrides configured TTL

Cloudflare only honors a custom TTL on DNS-only (unproxied) A, AAAA, and CNAME records. The moment a record's `proxied` field is `true`, Cloudflare silently coerces the stored `ttl` to `1` (Automatic, which resolves to a fixed ~300 seconds), no matter what TTL value your API call, script, or dashboard form actually sent. A DNS-as-code source that declares `ttl: 300` alongside `proxied: true` will apply "successfully" while the live zone permanently shows `ttl=1`.

This script fetches live records from the Cloudflare API, compares each record's `(ttl, proxied)` against an intended-config source, and flags any record where `proxied` is true but the intended `ttl` is not 1 as a reconciliation mismatch rather than blind drift. A repair mode then either accepts `ttl: 1` (matching Cloudflare's constraint) or sets `proxied: false` with the desired TTL (enforcing a real custom TTL), depending on policy.

Full guide with diagrams, step-by-step fix, and verification commands:
https://www.allanninal.dev/dns/proxied-record-forces-ttl/

## Run it

Python:

```bash
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export DRY_RUN="true"   # start safe, change to false to write
export REPAIR_POLICY="accept_automatic"   # or "unproxy"
python python/proxied_record_forces_ttl.py
```

Node.js:

```bash
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export DRY_RUN="true"   # start safe, change to false to write
export REPAIR_POLICY="accept_automatic"   # or "unproxy"
node node/proxied-record-forces-ttl.js
```

Both scripts import `dnspython` / provider clients and network calls lazily inside `run()`. The decision function, `diagnose_ttl_proxy_mismatch` / `diagnoseTtlProxyMismatch`, is pure and needs no network to test.

## Test

Python:

```bash
cd python
pip install pytest
pytest test_proxied_ttl_diagnose.py -v
```

Node.js:

```bash
cd node
node --test proxied-record-forces-ttl.test.js
```
