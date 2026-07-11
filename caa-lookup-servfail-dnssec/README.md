# CAA lookup fails due to broken DNSSEC chain

A certificate renewal can fail with a DNS problem looking up CAA error even
when the CAA record itself is completely fine. Under the CA/Browser Forum
Baseline Requirements, a certificate authority must validate DNSSEC when it
is present, and it must treat any DNSSEC validation error, which shows up as
SERVFAIL, as an inability to confirm CAA policy, so it refuses to issue or
renew. This usually happens because the DS record published at the
registrar no longer matches the DNSKEY currently signing the zone at the
DNS host, left over from an incomplete key rollover, a DNS provider
migration, or DNSSEC being disabled without removing the DS record first.

This script queries CAA against a DNSSEC-validating resolver, retries the
same query with checking disabled, and uses a pure function to decide
whether the failure is a broken DNSSEC chain (a DS mismatch or an expired
RRSIG) or something unrelated to DNSSEC entirely. If you are on Cloudflare
and the fix is to disable DNSSEC, it can also read or update the zone's
DNSSEC status through the Cloudflare API. Updating the DS record itself
always stays a registrar action, outside any DNS provider's record API.

Guide: https://www.allanninal.dev/dns/caa-lookup-servfail-dnssec/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export VALIDATING_RESOLVER="1.1.1.1"
export CLOUDFLARE_API_TOKEN="your token"     # optional, only used for Cloudflare zones
export CLOUDFLARE_ZONE_ID="your zone id"     # optional, only used for Cloudflare zones
export DISABLE_DNSSEC="false"                # set to true only after removing the DS record and waiting out its TTL
export DRY_RUN="true"   # set to false to allow the Cloudflare DNSSEC status change
python caa_lookup_servfail_dnssec.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export VALIDATING_RESOLVER="1.1.1.1"
export CLOUDFLARE_API_TOKEN="your token"     # optional, only used for Cloudflare zones
export CLOUDFLARE_ZONE_ID="your zone id"     # optional, only used for Cloudflare zones
export DISABLE_DNSSEC="false"                # set to true only after removing the DS record and waiting out its TTL
export DRY_RUN="true"   # set to false to allow the Cloudflare DNSSEC status change
node caa-lookup-servfail-dnssec.js
```

Requires the `dig` command line tool to be installed and on PATH.

## Test

The pure decision function `diagnose_caa_dnssec_break` / `diagnoseCaaDnssecBreak`
takes four plain booleans that were already fetched by dig or dnspython
elsewhere, and does no DNS work itself. No credentials, DNS library, or
network access are required to run the tests.

```bash
# Python
cd python
pytest test_chain_diagnosis.py

# Node.js
cd node
node --test
```
