# DMARC record missing or malformed

Detects a missing, duplicated, or malformed DMARC TXT record at `_dmarc.{domain}`,
and can repair it through the Cloudflare DNS API. A domain with no usable DMARC
record gives spoofed mail no enforcement and gives you no visibility, since
receivers cannot find a policy to apply.

Field notes guide: https://www.allanninal.dev/dns/dmarc-record-missing-or-malformed/

## What it does

1. Queries the TXT record at `_dmarc.{domain}` with dnspython (Python) or the
   built-in `node:dns/promises` module (Node.js).
2. Runs the result through a pure decision function, `validate_dmarc_record` /
   `validateDmarcRecord`, that checks:
   - exactly one TXT string exists at that name (not zero, not two or more)
   - the string starts with `v=DMARC1`
   - a `p=` tag comes immediately after, with a value of `none`, `quarantine`,
     or `reject`
   - no tag key appears more than once
3. If the record is missing, duplicated, or invalid, and Cloudflare credentials
   are set, it creates or repairs the record through the Cloudflare API.
4. Defaults to `DRY_RUN=true`, so it only logs what it would do until you
   explicitly turn that off.

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export DRY_RUN="true"   # set to "false" once you trust the plan
python dmarc_record_missing_or_malformed.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export DRY_RUN="true"   // set to "false" once you trust the plan
node dmarc-record-missing-or-malformed.js
```

Both scripts import dnspython / network clients lazily inside `run()`, so the
pure `validate_dmarc_record` / `validateDmarcRecord` function can be imported
and tested with zero network access and no credentials set.

## Test

### Python

```bash
cd python
pip install pytest
pytest test_dmarc_validate.py -v
```

### Node.js

```bash
cd node
node --test
```
