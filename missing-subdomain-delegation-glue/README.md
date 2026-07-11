# Subdomain delegation missing NS glue in parent zone

Detects when a subdomain (for example `app.example.com`) has a fully working
child DNS zone, but the parent zone (`example.com`) never got the NS records
that hand off authority to it. The child zone is correct and live, but it is
unreachable because the parent never points to it. The repair adds the
missing NS records in the parent zone through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/missing-subdomain-delegation-glue/

## Run it

Python:

```bash
pip install dnspython requests
export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for the repair
export CLOUDFLARE_ZONE_ID="your parent zone id"
export DRY_RUN="true"
python python/check_delegation.py
```

Node.js:

```bash
export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for the repair
export CLOUDFLARE_ZONE_ID="your parent zone id"
export DRY_RUN="true"
node node/check-delegation.js
```

Both start in dry run mode. They only try to write to Cloudflare when
`DRY_RUN=false` and both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`
are set.

## Test

The decision function, `is_delegation_missing` / `isDelegationMissing`, is
pure and needs no network. Tests run against plain lists.

```bash
pytest python/test_missing_delegation.py -q
node --test node/check-delegation.test.js
```
