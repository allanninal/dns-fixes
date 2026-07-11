# www and apex configured inconsistently

Most sites need two DNS records to answer under both names: an A/AAAA record (or a flattened ALIAS) at the bare zone apex, and a CNAME at www pointing at the same host. People often configure one and forget the other, or point the two at different backends, so one name resolves fine while the other returns NXDOMAIN, a parked page, or a different, older site.

Full write-up with diagrams: https://www.allanninal.dev/dns/www-apex-mismatch/

## What this does

- Resolves A, AAAA, and CNAME for both the apex domain and its www subdomain.
- Classifies the pair as `ok`, `apex_missing`, `www_missing`, `both_missing`, or `ip_mismatch` using a pure, I/O-free decision function.
- If a missing side is found and Cloudflare credentials are set, repairs it through the Cloudflare API: creates the missing A record at the apex or the missing CNAME at www, pointing it at the same target as the working side.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export REPLACEMENT_IP="203.0.113.10"       # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python www_apex_mismatch.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export REPLACEMENT_IP="203.0.113.10"       # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node www-apex-mismatch.js
```

## Test

The pure decision function, `diagnose_www_apex` (Python) / `diagnoseWwwApex` (Node), is tested with plain set/string fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
