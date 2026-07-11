# Auto-renewal enabled but payment failed

Auto-renew being on is a setting, not a guarantee. It only renews the domain if the charge to the payment method on file actually succeeds. When the card is expired, declined, or blocked by the bank as suspicious, the renewal attempt fails, no charge posts, and the domain's real expiration date at the registry does not move, even though the auto-renew toggle in the dashboard still shows on.

Full write-up with diagrams: https://www.allanninal.dev/dns/auto-renewal-payment-failure/

## What this does

- Queries RDAP, the modern ICANN-mandated replacement for WHOIS, for the domain's expiration event and current status.
- Compares the current expiration date against a previously recorded value using a pure, I/O-free decision function, to detect a stalled renewal (the date did not move forward since the last check).
- Flags domains already inside a grace or pending-delete state (`autoRenewPeriod`, `redemptionPeriod`, `pendingDelete`).
- When the domain is inside its warning window and the renewal looks stalled, or it is already in a grace period, it reconciles a CAA record with an `iodef` tag through the Cloudflare DNS API, so an alert contact is guaranteed to be in place. This is the one part of the problem that is an actual DNS zone record.
- Does not renew the domain or touch billing. That is a registrar account and payment action, not something a DNS provider's zone API can reach.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export ALERT_CONTACT_URI="mailto:domains@example.com"
export PREVIOUS_EXPIRATION_ISO=""   # optional, an ISO date from a prior run
export DRY_RUN="true"    # set to "false" to actually write the CAA record

python auto_renewal_payment_failure.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
export ALERT_CONTACT_URI="mailto:domains@example.com"
export PREVIOUS_EXPIRATION_ISO=""   # optional, an ISO date from a prior run
export DRY_RUN="true"    # set to "false" to actually write the CAA record

node auto-renewal-payment-failure.js
```

## Test

The pure decision function, `evaluate_renewal` (Python) and `evaluateRenewal` (Node), is tested with fixed ISO timestamps and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
