# MX record has no A or AAAA record

An MX record only names a hostname that should receive mail for a domain, it
does not carry an IP address of its own. A sending mail server has to look
up an A or AAAA record for that exact hostname next. If that address record
was never created, was deleted, or points at a CNAME instead, the sending
server has nowhere to connect and mail bounces or queues until it times out.
This script resolves a domain's MX records, resolves A and AAAA for each
target hostname, flags any target where both lookups come back empty as a
dangling MX, and, when repairing, creates the missing A record through the
Cloudflare API.

Guide: https://www.allanninal.dev/dns/mx-target-missing-address-record/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export RECORD_TARGET="203.0.113.25"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create the record
python mx_target_missing_address_record.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export RECORD_TARGET="203.0.113.25"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create the record
node mx-target-missing-address-record.js
```

## Test

The pure decision function `find_dangling_mx_targets` / `findDanglingMxTargets`
takes plain lists and a plain mapping. No network, no DNS library, no
Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_mx_target.py

# Node.js
cd node
node --test
```
