# CNAME coexists with another record type at same name

A CNAME record tells a resolver that a name is only an alias, so DNS rules forbid any other record type, such as an A, MX, or TXT record, from existing at that exact same name. This most often happens when a CNAME is added for a marketing tool or CDN to a hostname that already has a TXT record for SPF, DKIM, or DMARC, or an A or MX record. The zone does not reject the second record, it just starts serving broken or unpredictable answers.

Full write-up with diagrams: https://www.allanninal.dev/dns/cname-coexistence-violation/

## What this does

- Lists every DNS record in a Cloudflare zone (or queries the common record types at a single name if no Cloudflare credentials are set).
- Groups the records by name using a pure, I/O-free decision function, `find_cname_coexistence_violations` (Python) / `findCnameCoexistenceViolations` (Node).
- Flags any name whose group contains a CNAME record together with any other record type.
- If Cloudflare credentials are set, repairs the conflict by deleting the non-CNAME records at that name through the Cloudflare API.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for a full zone scan and repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for a full zone scan and repair
export DRY_RUN="true"                      # set to "false" to actually write

python cname_coexistence.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for a full zone scan and repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for a full zone scan and repair
export DRY_RUN="true"                      # set to "false" to actually write

node cname-coexistence.js
```

## Test

The pure decision function, `find_cname_coexistence_violations` (Python) / `findCnameCoexistenceViolations` (Node), is tested with plain list/array fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
