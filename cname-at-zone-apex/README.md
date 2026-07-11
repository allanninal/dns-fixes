# CNAME at zone apex conflicts with NS or SOA

A literal CNAME record on the bare domain (the zone apex, e.g. `example.com`) conflicts with the SOA and NS records that must live there. It either gets rejected by the DNS server, or it breaks the zone by shadowing SOA, NS, MX, and TXT answers. The fix is to replace the apex CNAME with real A/AAAA records, or use a provider-side flattening/ALIAS feature that resolves the CNAME target server-side and publishes plain A/AAAA answers.

Full write-up with diagrams: https://www.allanninal.dev/dns/cname-at-zone-apex/

## What this does

- Queries CNAME, A, AAAA, NS, and SOA at the zone apex.
- Classifies the apex as `ok`, `conflict_literal_cname`, or `flattened_ok` using a pure, I/O-free decision function.
- If a conflict is found and Cloudflare credentials are set, repairs it through the Cloudflare API: deletes the offending CNAME record and creates an A record in its place.
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

python apex_cname_conflict.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export REPLACEMENT_IP="203.0.113.10"       # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node apex-cname-conflict.js
```

## Test

The pure decision function, `classify_apex_cname_conflict` (Python) / `classifyApexCnameConflict` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
