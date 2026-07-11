# Duplicate record set falsely flagged as conflict

A weighted, latency, failover, geoproximity, or multivalue record set gets blocked by a reconciler, CI script, or Terraform-adjacent tool that calls it a "duplicate," even though the zone itself is set up correctly. This happens when the dedup check keys only on `(name, type)` instead of the provider's real identity key, `(name, type, SetIdentifier)` for Route 53-style providers, or `(name, type, content)` for providers like Cloudflare that have no SetIdentifier concept.

Full write-up with diagrams: https://www.allanninal.dev/dns/false-positive-duplicate-detection/

## What this does

- Lists the live DNS records at a name through the Cloudflare API.
- Runs a pure, I/O-free decision function, `is_duplicate_record` (Python) / `isDuplicateRecord` (Node), that only calls two records a true duplicate when they match on name, type, and SetIdentifier (or content, when SetIdentifier is absent).
- Diffs an "intended" record list against the live zone using that correct key, so a genuinely new SetIdentifier or value is never blocked as a false positive.
- If a record is not a real duplicate and Cloudflare credentials are set, applies it through the Cloudflare API.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install requests

export DNS_DOMAIN="acme.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python false_positive_duplicate_detection.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="acme.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node false-positive-duplicate-detection.js
```

## Test

The pure decision function, `is_duplicate_record` (Python) / `isDuplicateRecord` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
