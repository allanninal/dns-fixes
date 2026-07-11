# Required DKIM CNAME selectors not published

Microsoft 365 signs mail with keys it rotates on its own schedule, and it needs two CNAME records, `selector1._domainkey` and `selector2._domainkey`, pointing at a target hostname on its infrastructure to make that rotation work. If either selector is missing, points at the wrong target, or was published as a TXT record instead of a CNAME, rotation stalls and DKIM signatures stop validating. With DMARC set to quarantine or reject, that can cause real mail to fail delivery.

Full write-up with diagrams: https://www.allanninal.dev/dns/dkim-cname-selector-not-published/

## What this does

- Queries CNAME (and TXT, to catch a wrong-type conflict) for both `selector1._domainkey` and `selector2._domainkey`.
- Compares what it finds against the exact per-tenant target hostnames you provide, using a pure, I/O-free decision function.
- Flags each selector as `missing`, `wrong_type` (a TXT record where a CNAME is required), or `target_mismatch`.
- If issues are found and Cloudflare credentials are set, repairs them through the Cloudflare API: deletes any conflicting TXT record and creates the correct CNAME in its place.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="yourdomain.com"
export DKIM_SELECTOR1_TARGET="selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com"
export DKIM_SELECTOR2_TARGET="selector2-yourdomain-com._domainkey.yourdomain.onmicrosoft.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

python dkim_selector_check.py
```

Get the exact `DKIM_SELECTOR1_TARGET` and `DKIM_SELECTOR2_TARGET` values for your own tenant with:

```powershell
Get-DkimSigningConfig -Identity yourdomain.com | Format-List Selector1CNAME,Selector2CNAME,Status
```

### Node.js

```bash
cd node

export DNS_DOMAIN="yourdomain.com"
export DKIM_SELECTOR1_TARGET="selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com"
export DKIM_SELECTOR2_TARGET="selector2-yourdomain-com._domainkey.yourdomain.onmicrosoft.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for repair
export DRY_RUN="true"                      # set to "false" to actually write

node dkim-selector-check.js
```

## Test

The pure decision function, `check_dkim_selectors` (Python) / `checkDkimSelectors` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
