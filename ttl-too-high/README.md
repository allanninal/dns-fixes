# TTL set too high delays urgent changes

A record's TTL, the number of seconds a resolver may reuse a cached answer, is set to an hour, a day, or more. When an urgent DNS change is needed, the record is fixed correctly and immediately at the DNS host, but every resolver that already cached the old answer keeps serving it until that old TTL runs out. The fix looks broken for hours even though it was never wrong.

Full write-up with diagrams: https://www.allanninal.dev/dns/ttl-too-high/

## What this does

- Looks up a record's current TTL in seconds.
- Classifies it as `safe` or `high_ttl` against a configurable threshold, using a pure, I/O-free decision function.
- Treats an automatic TTL of `1` (used by some providers) as safe.
- If the TTL is flagged and Cloudflare credentials are set, repairs it through the Cloudflare API: lowers the record's TTL to a safe value well ahead of the real change that needs to propagate quickly.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="yourdomain.com"
export DNS_RECORD_TYPE="A"                 # A, AAAA, etc.
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export SAFE_TTL_SECONDS="300"              # TTL to lower flagged records to
export TTL_THRESHOLD_SECONDS="3600"        # TTL above this is flagged
export DRY_RUN="true"                      # set to "false" to actually write

python ttl_too_high.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="yourdomain.com"
export DNS_RECORD_TYPE="A"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export SAFE_TTL_SECONDS="300"
export TTL_THRESHOLD_SECONDS="3600"
export DRY_RUN="true"

node ttl-too-high.js
```

## Test

The pure decision function, `classify_ttl` (Python) / `classifyTtl` (Node), is tested with plain numeric fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
