# TLS certificate nearing or past expiry

Let's Encrypt certificates only last ninety days, so a host depends entirely on an automated renewal job running on time, usually around day sixty to sixty seven. If that job fails quietly, a blocked port, a broken DNS-01 record, an expired ACME account, or a missing reload hook, the old certificate keeps serving traffic right up to its expiry date, then every client starts rejecting the connection with no advance warning.

Full write-up with diagrams: https://www.allanninal.dev/dns/tls-certificate-expiring/

## What this does

- Opens a raw TLS socket to the target host on port 443 with SNI set and reads the live peer certificate, not the renewal tool's logs.
- Computes days until expiry and classifies the result as `ok`, `warn`, `critical`, or `expired` using a pure, I/O-free decision function.
- If the certificate is close to expiry or past it, checks the domain's CAA record. If CAA only permits a different certificate authority than the one in use, that is a likely renewal blocker.
- If Cloudflare credentials are set, repairs a blocking CAA record by adding one that permits the CA in use through the Cloudflare API.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for CAA repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for CAA repair
export CA_TO_PERMIT="letsencrypt.org"      # the CA your ACME client uses
export WARN_AT_DAYS="21"
export CRIT_AT_DAYS="7"
export DRY_RUN="true"                      # set to "false" to actually write

python check_tls_expiry.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for CAA repair
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for CAA repair
export CA_TO_PERMIT="letsencrypt.org"      # the CA your ACME client uses
export WARN_AT_DAYS="21"
export CRIT_AT_DAYS="7"
export DRY_RUN="true"                      # set to "false" to actually write

node check-tls-expiry.js
```

## Test

The pure decision functions, `days_until_expiry` / `classify` (Python) and `daysUntilExpiry` / `classify` (Node), are tested with synthetic datetimes and need no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
