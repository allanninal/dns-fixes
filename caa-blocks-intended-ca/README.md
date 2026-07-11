# CAA record blocks certificate issuance for the intended CA

A CAA (Certification Authority Authorization) record restricts which
certificate authorities may issue certificates for a domain. Per RFC 8659,
every CA must check this record before issuing and must refuse if the
domain has an `issue` or `issuewild` record that does not name it. This
commonly happens after a domain migrates CAs, after a DNS host silently adds
its own restrictive CAA record, or after someone locks CAA to a specific
ACME account with `accounturi` and then switches ACME clients or accounts.
This script walks up the DNS tree from a name to find the nearest CAA
record set, decides with a pure function whether the intended CA is
permitted, and, if not, adds the missing `issue` record through the
Cloudflare API.

Guide: https://www.allanninal.dev/dns/caa-blocks-intended-ca/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export INTENDED_CA="letsencrypt.org"
export IS_WILDCARD="false"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually add the missing CAA record
python caa_blocks_intended_ca.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export INTENDED_CA="letsencrypt.org"
export IS_WILDCARD="false"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually add the missing CAA record
node caa-blocks-intended-ca.js
```

## Test

The pure decision function `caa_permits_ca` / `caaPermitsCa` takes a list of
plain `(tag, value)` pairs and a CA identifier string, and does no DNS I/O
and no network calls. No credentials or DNS library are required to run the
tests.

```bash
# Python
cd python
pytest test_caa_permits.py

# Node.js
cd node
node --test
```
