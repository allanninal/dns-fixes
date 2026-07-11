# Domain nearing expiration without renewal action

A domain's registration has a hard expiration date at the registry, and it gets missed when auto-renew is off, the payment method on file has expired, or the renewal reminder emails go to an inbox nobody actively reads. Nobody is watching the RDAP expiration date on a schedule, so the domain drifts inside its 30 or 60 day warning window with no renewal triggered, and if it lapses the site, DNS, and email all go dark once the registry deletes it.

Full write-up with diagrams: https://www.allanninal.dev/dns/domain-expiration-approaching/

## What this does

- Queries RDAP, the modern ICANN-mandated replacement for WHOIS, for the domain's expiration event and current status.
- Computes days until expiry and classifies the result as `ok`, `warning`, `critical`, or `expired` using a pure, I/O-free decision function against a list of warning thresholds (default `30, 14, 7, 1`).
- Flags domains already inside a grace or pending-delete state (`autoRenewPeriod`, `redemptionPeriod`, `pendingDelete`).
- Sends an alert (log line by default, wire in email, Slack, or a webhook for production) when the domain crosses a threshold.
- Does not call any DNS provider API to fix anything. Renewal is a registrar and billing action, not a DNS zone record, so this script is detection and alerting only.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install requests

export DNS_DOMAIN="example.com"
export DRY_RUN="true"    # set to "false" to send real alerts instead of dry-run logs

python check_domain_expiry.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export DRY_RUN="true"    # set to "false" to send real alerts instead of dry-run logs

node check-domain-expiry.js
```

## Test

The pure decision function, `days_until_expiry` (Python) and `daysUntilExpiry` (Node), is tested with fixed ISO timestamps and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
