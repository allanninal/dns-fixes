# Transfer blocked by registrar lock near expiry

A domain near its expiration date still has `clientTransferProhibited` set, so an outbound transfer to a new registrar gets rejected even though the domain itself has not expired. The lock and the expiry countdown are independent settings, but the combination creates a time-pressure failure when nobody notices the lock is on until they actually need to transfer.

Full write-up with diagrams: https://www.allanninal.dev/dns/transfer-lock-blocking-renewal/

## What this does

- Queries RDAP for the domain's status array and its expiration event in one request.
- Normalizes the status codes and checks for `clientTransferProhibited` or `serverTransferProhibited`, using a pure, I/O-free decision function.
- Computes days until expiry and flags the domain only when it is both locked and inside a configurable warning window (default 30 days).
- Reports the finding (log line by default, wire in email, Slack, or a webhook for production).
- Does not call any DNS provider API to fix anything. Removing a registrar transfer lock is an account or registrar-portal action, not a DNS zone record, so this script is detection and alerting only.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install requests

export DNS_DOMAIN="example.com"
export WARNING_DAYS="30"
export DRY_RUN="true"    # set to "false" to send real alerts instead of dry-run logs

python check_transfer_lock_risk.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export WARNING_DAYS="30"
export DRY_RUN="true"    # set to "false" to send real alerts instead of dry-run logs

node check-transfer-lock-risk.js
```

## Test

The pure decision function, `assess_transfer_risk` (Python) and `assessTransferRisk` (Node), is tested with fixed status lists and datetimes and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
