# SPF exceeds the 10 DNS lookup limit

RFC 7208 caps SPF evaluation at 10 DNS-lookup-causing mechanisms per check:
`include`, `a`, `mx`, `ptr`, `exists`, and the `redirect` modifier, counted
recursively through every nested include. Stacking a few vendor includes
(Google Workspace, Microsoft 365, SendGrid, Mailchimp, HubSpot) is often
enough to pass 10 once their own nested includes are counted, and once the
real count is over 10, receivers must return a PermError, which most
DMARC-enforcing mail servers treat as an outright SPF failure. This script
fetches the SPF record, recursively resolves every include, redirect, a,
mx, ptr, and exists mechanism (tracking void lookups too), sums the total
with a pure counting function, and, if the count is over 10, computes a
flattened set of static addresses and replaces the TXT record through the
Cloudflare API.

Guide: https://www.allanninal.dev/dns/spf-exceeds-lookup-limit/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually replace the SPF record
python spf_exceeds_lookup_limit.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually replace the SPF record
node spf-exceeds-lookup-limit.js
```

## Test

The pure decision function `count_spf_lookups` / `countSpfLookups` takes
the raw SPF string and an injected resolver function, and does no DNS I/O
and no network calls. No credentials or DNS library are required to run
the tests.

```bash
# Python
cd python
pytest test_spf_lookups.py

# Node.js
cd node
node --test
```
