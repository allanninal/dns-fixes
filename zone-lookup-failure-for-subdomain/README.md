# Zone lookup fails to resolve the correct managed zone

ACME DNS-01 clients (lego, which powers cert-manager, Certbot's DNS plugins, and Traefik) do not know ahead of time which zone in your DNS provider account owns a name. They walk up the challenge name label by label asking for an SOA record, and treat the first apex that answers as "the zone." This breaks when a subdomain is delegated to a different zone or provider than its parent, or when the apex the walk finds is not the exact zone name registered with the provider's API, and the client fails with an error like "could not determine the zone" or "NXDOMAIN looking up TXT record." This script replicates the label walk with dnspython (or Node's built-in dns module), checks the found apex against the Cloudflare account's zone list, reports any mismatch, and, once a usable zone is confirmed, can write the `_acme-challenge` TXT record through the Cloudflare API.

**Full guide with diagrams:** https://www.allanninal.dev/dns/zone-lookup-failure-for-subdomain/

## Run it

```bash
export DNS_DOMAIN="sub.example.com"
export CHALLENGE_VALUE="the-acme-challenge-token"
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ZONE_ID="your-zone-id"
export DRY_RUN="true"   # start safe, change to false to write

# Python
pip install dnspython requests
python zone-lookup-failure-for-subdomain/python/resolve_acme_zone.py

# Node
node zone-lookup-failure-for-subdomain/node/resolve-acme-zone.js
```

## Test

```bash
pytest zone-lookup-failure-for-subdomain/python
node --test zone-lookup-failure-for-subdomain/node
```
