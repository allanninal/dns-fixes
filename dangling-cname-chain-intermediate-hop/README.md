# Dangling CNAME chain with a claimable intermediate hop

Walks a CNAME chain hop by hop, starting from a top-level hostname, and
follows each successive CNAME target until it hits a terminal A/AAAA record,
an NXDOMAIN, or a possible loop. It flags the first hop in the chain (not
just the first hop overall) that fails to resolve, since a dangling
intermediate hop is exactly the kind of break that shallow, first-hop-only
checks miss. When the offending hop is one your zone points into, the script
can repoint or delete the record you control through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/dangling-cname-chain-intermediate-hop/

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="app.example.com"
export MAX_DEPTH="10"
export DRY_RUN="true"                 # keep true until you trust the plan
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export REPLACEMENT_TARGET="app-prod.mycdnaccount.vendorone.net"  # omit to delete instead

python dangling_cname_chain.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="app.example.com"
export MAX_DEPTH="10"
export DRY_RUN="true"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export REPLACEMENT_TARGET="app-prod.mycdnaccount.vendorone.net"

node dangling-cname-chain.js
```

Both scripts default to `DRY_RUN=true` and only report what they would do.
Set `DRY_RUN=false` once you have reviewed the plan.

## Test

The chain-walking decision logic (`find_dangling_hop` / `findDanglingHop`) is
a pure function with no network calls, so the tests run with no DNS library,
no Cloudflare credentials, and no network access at all.

### Python

```bash
cd python
pip install pytest
pytest -v
```

### Node.js

```bash
cd node
node --test
```
