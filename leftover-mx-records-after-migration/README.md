# Leftover MX records from a decommissioned provider

A domain migrates to a new mail provider, like Google Workspace or Microsoft 365, and the admin adds the new MX records but never removes the old provider's records from the zone. A DNS MX lookup returns every MX record for a domain no matter who owns it, so mail can now be delivered to whichever host wins on priority, or split between the old and new provider, and some of it can land in a decommissioned mailbox nobody checks.

Full write-up with diagrams: https://www.allanninal.dev/dns/leftover-mx-records-after-migration/

## What this does

- Queries the domain's live MX records and reads every (priority, exchange host) pair.
- Runs a pure, I/O-free decision function, `find_leftover_mx` (Python) / `findLeftoverMx` (Node), that flags any exchange host whose hostname does not end with one of the intended provider's documented suffixes (for example `google.com.` or `mail.protection.outlook.com.`).
- If leftover records are found and Cloudflare credentials are set, repairs the zone by deleting each leftover MX record, leaving only the intended provider's records in place.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export INTENDED_MX_SUFFIXES="google.com."       # comma separated if more than one
export CLOUDFLARE_API_TOKEN="your token"        # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"        # only needed for repair
export DRY_RUN="true"                           # set to "false" to actually write

python leftover_mx_records_after_migration.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export INTENDED_MX_SUFFIXES="google.com."       # comma separated if more than one
export CLOUDFLARE_API_TOKEN="your token"        # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"        # only needed for repair
export DRY_RUN="true"                           # set to "false" to actually write

node leftover-mx-records-after-migration.js
```

## Test

The pure decision function, `find_leftover_mx` (Python) / `findLeftoverMx` (Node), is tested with plain tuple fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
