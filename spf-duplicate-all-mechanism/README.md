# SPF record has a duplicate or misplaced all mechanism

SPF evaluates a record left to right and stops at the first mechanism that matches. The `all` mechanism always matches, so it must appear exactly once, as the very last mechanism. When a record has two `all` tokens, or an `all` that is not last, everything after the first `all` is dead code that receivers must ignore, and the domain's real policy is silently overridden by whichever `all` comes first.

Full write-up with diagrams: https://www.allanninal.dev/dns/spf-duplicate-all-mechanism/

## What this does

- Fetches the domain's TXT records and isolates the one starting with `v=spf1`.
- Tokenizes the record and checks it with a pure, I/O-free decision function: flags the record if the count of `all`/`+all`/`-all`/`~all`/`?all` tokens is not exactly 1, or if that single `all` token is not the last token.
- If an issue is found and Cloudflare credentials are set, rebuilds a corrected record (moving/deduplicating `all` to the end with the chosen qualifier) and repairs it through the Cloudflare API.
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

python spf_all_mechanism.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node spf-all-mechanism.js
```

## Test

The pure decision function, `check_spf_all_mechanism` (Python) / `checkSpfAllMechanism` (Node), and the record rebuilder are tested with plain string fixtures and need no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
