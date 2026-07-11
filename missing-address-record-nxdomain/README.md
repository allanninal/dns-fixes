# Missing A or AAAA record causes NXDOMAIN

A hostname with no A, AAAA, or CNAME record anywhere in the zone returns
NXDOMAIN, meaning the name does not exist at all. This is different from
NOERROR with an empty answer (NODATA), which means the name exists but not
for the record type you asked about. This script queries the authoritative
nameservers directly, classifies the answer, and, when a name that is
expected to be live comes back NXDOMAIN, creates the missing record through
the Cloudflare API.

Guide: https://www.allanninal.dev/dns/missing-address-record-nxdomain/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="app.example.com"
export RECORD_TYPE="A"
export RECORD_TARGET="203.0.113.10"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create the record
python missing_address_record.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="app.example.com"
export RECORD_TYPE="A"
export RECORD_TARGET="203.0.113.10"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create the record
node missing-address-record.js
```

## Test

The pure decision function `classify_missing_record` / `classifyMissingRecord`
takes plain strings, an int, and a bool. No network, no DNS library, no
Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_missing.py

# Node.js
cd node
node --test
```
