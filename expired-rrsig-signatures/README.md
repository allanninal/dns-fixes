# Expired RRSIG signatures break validation

Every RRSIG record carries an expiration timestamp. A DNS host is supposed to quietly re-sign the zone well before that date and publish a fresh RRSIG with a new expiration window. When that re-signing stops, the old RRSIG keeps being served past its expiration date. A validating resolver checks that date first and refuses to trust an expired signature no matter how correct the underlying record is, so it returns SERVFAIL.

Full write-up with diagrams: https://www.allanninal.dev/dns/expired-rrsig-signatures/

## What this does

- Queries the RRSIG record covering a given record type for a domain and reads its expiration timestamp.
- Flags the signature as `expired`, `expiring_soon`, or `ok`, using a pure, I/O-free decision function that compares the expiration against the current time and a warning window.
- If Cloudflare credentials are set, reads the zone's current DNSSEC status and, when the signature is expired or expiring soon, triggers a re-sign by re-asserting the DNSSEC status as active, which issues fresh RRSIG records with a new expiration.
- Zones signed with a self-hosted or offline signer fall back to a manual re-sign, since there is no Cloudflare-style API to call.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export RECORD_TYPE="A"                     # record type the RRSIG covers
export WARN_HOURS="48"                     # how soon counts as "expiring soon"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python expired_rrsig_signatures.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export RECORD_TYPE="A"
export WARN_HOURS="48"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node expired-rrsig-signatures.js
```

## Test

The pure decision function, `check_rrsig_expiration` (Python) / `checkRrsigExpiration` (Node), is tested with plain datetime fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
