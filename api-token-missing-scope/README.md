# API token missing required scope blocks DNS automation

A Cloudflare API token scoped too narrowly, for example one that only has Zone, DNS, Edit, blocks most DNS automation before it ever writes a record. That is because most DNS clients (an ACME DNS-01 client, cert-manager, Terraform, a CI pipeline) first call a zone-list endpoint to turn a domain name into a zone ID, and that call needs Zone, Zone, Read. If the token is missing that permission group, the lookup fails with an authentication error and the automation aborts before it reaches the DNS write it actually had permission for. This script runs the same calls the automation makes, `/user/tokens/verify`, `GET /zones?name=...`, and a harmless `GET /zones/{id}/dns_records` read, and classifies exactly which permission group is missing.

**Full guide with diagrams:** https://www.allanninal.dev/dns/api-token-missing-scope/

## Run it

```bash
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your-scoped-token"
export CLOUDFLARE_ZONE_ID=""   # optional, resolved automatically from DNS_DOMAIN if empty
export DRY_RUN="true"          # this check never writes an automation record regardless

# Python
pip install requests
python api-token-missing-scope/python/diagnose_token_scope.py

# Node
node api-token-missing-scope/node/diagnose-token-scope.js
```

The script prints one of five verdicts: `ok`, `token_invalid`, `missing_zone_read`, `missing_dns_edit`, or `unknown_error`, along with a plain-language explanation of which Cloudflare permission group to add and where.

## Test

```bash
pytest api-token-missing-scope/python
node --test api-token-missing-scope/node
```
