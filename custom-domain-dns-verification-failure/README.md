# Hosting provider DNS check fails on a custom domain setup

GitHub Pages, Netlify, and Vercel verify a custom domain by checking that its
apex A/AAAA records and its www CNAME target match the exact values the host
publishes. This script resolves the apex A records and the www CNAME target,
compares them against GitHub Pages' published required set, and reports which
apex IPs are missing or extra and whether www points at the right host. When
repair is turned on, it replaces the stale records in Cloudflare with the
correct ones.

Guide: https://www.allanninal.dev/dns/custom-domain-dns-verification-failure/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export GITHUB_PAGES_HOSTNAME="yourusername.github.io"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually replace the records
python custom_domain_dns_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export GITHUB_PAGES_HOSTNAME="yourusername.github.io"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually replace the records
node custom-domain-dns-check.js
```

## Test

The pure decision function `diagnose_pages_dns` / `diagnosePagesDns` takes
plain sets and strings. No network, no DNS library, no Cloudflare credentials
required to run the tests.

```bash
# Python
cd python
pytest test_custom_domain.py

# Node.js
cd node
node --test
```
