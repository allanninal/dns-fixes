# CAA blocks wildcard certificate issuance specifically

A CAA `issuewild` record at the apex governs wildcard certificate requests
only, and per RFC 8659, once any `issuewild` record exists it completely
overrides `issue` for wildcard names. If `issuewild` names a different CA
than `issue`, or is set to `issuewild ";"` (deny all), the base domain issues
fine while every wildcard request from the same CA is rejected with a CAA
policy error. This script fetches the apex CAA RRset with dnspython, parses
every `issue` and `issuewild` tag, and flags the mismatch by name. When run
as a repair, it finds the offending record through the Cloudflare API and
updates it to match the CA you actually use.

Guide: https://www.allanninal.dev/dns/caa-blocks-wildcard-issuance/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export DESIRED_CA="letsencrypt.org"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually update the issuewild record
python wildcard_caa_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export DESIRED_CA="letsencrypt.org"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually update the issuewild record
node wildcard-caa-check.js
```

## Test

The pure decision function `wildcard_caa_blocked` / `wildcardCaaBlocked` takes
a list of (flags, tag, value) tuples parsed from the apex CAA RRset and the
CA identification domain the ACME client uses. No network, no DNS library,
no Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_caa_wildcard.py

# Node.js
cd node
node --test
```
