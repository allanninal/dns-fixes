# Wildcard record creates unintended catch-all exposure

A wildcard DNS record such as `*.example.com A 203.0.113.10` is a synthesis
rule: any query under that zone with no exact match and no closer match gets
an answer built from the wildcard, including names nobody ever intended to
create. That means typos, decommissioned subdomains, and names an attacker
guesses (`admin.`, `internal.`, `vpn.`, `payments.`) all resolve successfully
instead of returning NXDOMAIN, which hides real problems and can be used for
phishing or to make a dangling third-party target look safe. This script
lists every record in a zone through the Cloudflare API, flags wildcard
records, classifies each one as apex-level versus scoped to a subzone, and
live-probes a couple of random and typo names to confirm true catch-all
behavior. When run as a repair, it deletes the confirmed apex-level wildcard.

Guide: https://www.allanninal.dev/dns/wildcard-catch-all-exposure/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually delete the confirmed wildcard
python wildcard_catch_all.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually delete the confirmed wildcard
node wildcard-catch-all.js
```

## Test

The pure decision function `classify_wildcard_scope` / `classifyWildcardScope`
takes two plain strings (a record name and a zone apex) and does label math.
No network, no DNS library, no Cloudflare credentials required to run the
tests.

```bash
# Python
cd python
pytest test_wildcard_scope.py

# Node.js
cd node
node --test
```
