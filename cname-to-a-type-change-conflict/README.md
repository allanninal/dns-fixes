# CNAME to A record type change fails on existing RRSet

DNS forbids a CNAME from coexisting with any other record type at the same name. When a deploy tool swaps a CNAME for an A record by sending a delete and a create as two separate API calls, the create can race ahead of the delete finishing, and the DNS host rejects the new A record because it still sees the old CNAME at that name. The fix is to stop treating this as delete-then-create and instead overwrite the existing record in place with a single atomic call.

Full write-up with diagrams: https://www.allanninal.dev/dns/cname-to-a-type-change-conflict/

## What this does

- Checks whether a CNAME is still resolving at a name where an A record is wanted.
- Lists the live Cloudflare records at that name.
- Decides the correct action with a pure, I/O-free function, `plan_rrset_change` (Python) / `planRrsetChange` (Node): `noop` if the desired record already matches, `overwrite` if exactly one conflicting record (such as a CNAME) exists at the name, or `create` if nothing exists yet.
- Repairs an `overwrite` case with a single Cloudflare `PUT` on the existing record's own ID, so a CNAME and an A record are never both present at the name at the same time.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DESIRED_A_RECORD_IP="203.0.113.10"
export DESIRED_TTL="300"
export DRY_RUN="true"                      # set to "false" to actually write

python cname_to_a.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DESIRED_A_RECORD_IP="203.0.113.10"
export DESIRED_TTL="300"
export DRY_RUN="true"                      # set to "false" to actually write

node cname-to-a.js
```

## Test

The pure decision function, `plan_rrset_change` (Python) / `planRrsetChange` (Node), is tested with plain list/array fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
