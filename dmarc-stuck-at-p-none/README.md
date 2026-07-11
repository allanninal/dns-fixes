# DMARC stuck at policy none indefinitely

DMARC's own spec treats p=none as "collect data, take no action." It was
designed as a safe first step, not an end state, so mail keeps flowing to the
inbox even when SPF or DKIM fail. Teams publish p=none to start receiving
aggregate reports, then never come back to review those reports, fix
unaligned senders, and raise the policy to quarantine or reject. This script
checks the DMARC record for a domain, flags it if the policy is still none,
and, when the reports show it is safe, patches the same TXT record through
the Cloudflare API to raise the policy one stage.

Guide: https://www.allanninal.dev/dns/dmarc-stuck-at-p-none/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export DAYS_SINCE_LAST_CHANGE="200"
export SPF_DKIM_ALIGNED_PCT="0.99"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually patch the record
python dmarc_policy_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export DAYS_SINCE_LAST_CHANGE="200"
export SPF_DKIM_ALIGNED_PCT="0.99"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually patch the record
node dmarc-policy-check.js
```

## Test

The pure decision function `next_dmarc_policy` / `nextDmarcPolicy` takes a
plain DMARC record string and two numbers. No network, no DNS library, no
Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_dmarc_policy.py

# Node.js
cd node
node --test
```
