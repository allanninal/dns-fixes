# DKIM selector record missing or not propagated

A DKIM signature names a selector, and receivers must fetch a TXT record at
selector._domainkey.yourdomain.com to get the public key. If that record was
never published, was published at the wrong host, or has not propagated yet,
verifiers get NXDOMAIN or no answer and cannot check the signature, so DKIM
comes back none or permfail even though signing itself is working. This
script checks a list of candidate selectors against multiple public
resolvers, flags any that are missing or malformed, and, when told to
repair, publishes or updates the TXT record through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/dkim-selector-missing/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export DKIM_SELECTORS="google,selector1,selector2,k1,s1"
export DKIM_RECORD_VALUE="v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG..."
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create or update the record
python dkim_selector_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export DKIM_SELECTORS="google,selector1,selector2,k1,s1"
export DKIM_RECORD_VALUE="v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG..."
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually create or update the record
node dkim-selector-check.js
```

## Test

The pure decision function `evaluate_dkim_selector` / `evaluateDkimSelector`
takes a plain list of TXT strings and two strings. No network, no DNS
library, no Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_dkim.py

# Node.js
cd node
node --test
```
