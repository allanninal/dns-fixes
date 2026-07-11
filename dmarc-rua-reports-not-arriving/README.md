# DMARC aggregate reports never arrive

RFC 7489 requires that when a DMARC record's rua (aggregate report) address
points at a mailbox on a different domain than the one publishing the policy,
that destination domain must publish a TXT record proving it agrees to
receive those reports. If that authorization record is missing, mail
providers like Google and Microsoft silently drop the reports instead of
sending them, and nothing bounces or errors to say so. This script reads the
DMARC record for a domain, works out the rua destination domain, checks
whether that domain has published the authorization record, and, when it is
missing, creates it through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/dmarc-rua-reports-not-arriving/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"   # zone that hosts the rua destination domain
export DRY_RUN="true"   # set to false to actually create the record
python dmarc_rua_auth_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"   # zone that hosts the rua destination domain
export DRY_RUN="true"   # set to false to actually create the record
node dmarc-rua-auth-check.js
```

## Test

The pure decision function `needs_third_party_auth` / `needsThirdPartyAuth`
takes plain strings and lists of TXT record values. No network, no DNS
library, no Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_rua_auth.py

# Node.js
cd node
node --test
```
