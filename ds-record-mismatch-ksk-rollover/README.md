# DS record mismatch after a KSK rollover

The Key Signing Key gets rolled in the zone, but the DS record at the
registrar never gets updated to match, or the new digest is typed in wrong.
A validating resolver hashes the live DNSKEY, compares it to the published
DS, finds no match, and returns SERVFAIL for the whole domain. This script
computes the DS digest the current live KSK should produce, compares it to
what the registry actually publishes, and, when the zone is hosted on
Cloudflare, refreshes Cloudflare's DNSSEC state through its API.

Guide: https://www.allanninal.dev/dns/ds-record-mismatch-ksk-rollover/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually refresh Cloudflare's DNSSEC state
python ds_ksk_mismatch.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually refresh Cloudflare's DNSSEC state
node ds-ksk-mismatch.js
```

Note: the DS record itself lives at the domain's registrar, not at the DNS
host. If the registrar is a third party, the script reports the mismatch
and the exact key tags involved, but publishing the corrected DS is a
manual registrar-portal action.

## Test

The pure decision function `ds_matches_ksk` / `dsMatchesKsk` takes plain
dictionaries or objects. No network, no DNS library, no Cloudflare
credentials required to run the tests.

```bash
# Python
cd python
pytest test_rollover_ds_match.py

# Node.js
cd node
node --test
```
