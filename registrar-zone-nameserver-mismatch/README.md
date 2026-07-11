# Registrar nameservers do not match the hosted zone

A domain has two separate nameserver lists: the one the registrar publishes to the registry, and the one the zone itself actually answers with. Moving a zone to a new DNS host only updates the second list, so if the registrar's list is never updated to match, resolvers keep following the old delegation and the DNS host's activation check keeps failing. This script detects the mismatch by comparing the registry-facing view (RDAP) against the live authoritative view (a direct NS query). It is diagnostic only: the registrar side cannot be changed through the Cloudflare DNS API, so the actual fix is a manual nameserver update at the registrar.

**Full guide with diagrams:** https://www.allanninal.dev/dns/registrar-zone-nameserver-mismatch/

## Run it

```bash
export DNS_DOMAIN="example.com"
export DRY_RUN="true"   # this check never writes regardless

# Python
pip install dnspython requests
python registrar-zone-nameserver-mismatch/python/check_ns_mismatch.py

# Node
node registrar-zone-nameserver-mismatch/node/check-ns-mismatch.js
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are accepted for consistency with the other fixes in this repo but are unused, since the Cloudflare DNS API only manages records inside a zone already delegated to it, not the registrar's delegation.

## Test

```bash
pytest registrar-zone-nameserver-mismatch/python
node --test registrar-zone-nameserver-mismatch/node
```
