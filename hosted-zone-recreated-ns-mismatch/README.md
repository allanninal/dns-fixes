# Hosted zone recreated with new NS values

Deleting a hosted zone and creating a new one with the same domain name does not give you the same nameservers back. Route 53, Cloudflare, and every other provider hand the new zone a fresh, randomly picked set of nameservers. The registrar still lists the old ones from the deleted zone, and nothing links the two automatically, so the domain keeps resolving through stale nameservers until a person updates the registrar. This script detects the mismatch by comparing the zone's live nameservers, read from the provider API, against the registrar-delegated nameservers from RDAP. It is diagnostic only: the registrar side cannot be changed through the Cloudflare DNS API, so the actual fix is a manual nameserver update at the registrar.

**Full guide with diagrams:** https://www.allanninal.dev/dns/hosted-zone-recreated-ns-mismatch/

## Run it

```bash
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ZONE_ID="your-zone-id"
export DRY_RUN="true"   # this check never writes regardless

# Python
pip install dnspython requests
python hosted-zone-recreated-ns-mismatch/python/check_recreated_zone_ns.py

# Node
node hosted-zone-recreated-ns-mismatch/node/check-recreated-zone-ns.js
```

## Test

```bash
pytest hosted-zone-recreated-ns-mismatch/python
node --test hosted-zone-recreated-ns-mismatch/node
```
