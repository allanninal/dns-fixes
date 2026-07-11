# Dangling CNAME enables subdomain takeover

A CNAME record points at a target (a cloud storage bucket, a static site project, a hosting account) that has since been deleted or cancelled. DNS still answers with that CNAME, so anyone who claims the exact same target name on the same provider can serve their own content under your subdomain. The fix is to find every CNAME whose target no longer resolves or answers as unclaimed, then delete the record or re-claim the target before someone else does.

Full write-up with diagrams: https://www.allanninal.dev/dns/dangling-cname-subdomain-takeover/

## What this does

- Follows the CNAME for a subdomain and probes whether the target still resolves and answers normally over HTTPS.
- Classifies the target as `ok`, `dangling`, or `unknown` using a pure, I/O-free decision function.
- If the target is dangling and Cloudflare credentials are set, repairs it through the Cloudflare API by deleting the offending CNAME record.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="promo.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python dangling_cname_takeover.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="promo.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node dangling-cname-takeover.js
```

## Test

The pure decision function, `classify_cname_target` (Python) / `classifyCnameTarget` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
