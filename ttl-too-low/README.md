# TTL set too low overloads authoritative nameservers

Every DNS answer carries a TTL that tells resolvers how long they may serve
it from cache before asking your authoritative nameservers again. Leaving
TTL at a migration-era value like 30 to 60 seconds instead of raising it
back afterward forces resolvers worldwide to re-query far more often, since
query volume is roughly inversely proportional to TTL. Dropping from 3600
seconds to 60 seconds can multiply authoritative query load by about 60
times, which can slow down nameserver responses or trigger rate limiting on
a busy domain. This script reads a record's current TTL, combines it with
a known or estimated count of daily unique resolvers to estimate
authoritative query load with a pure decision function, and, if the record
is flagged as risky, raises the TTL through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/ttl-too-low/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DAILY_UNIQUE_RESOLVERS="50000"
export DRY_RUN="true"   # set to false to actually raise the TTL
python ttl_too_low.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DAILY_UNIQUE_RESOLVERS="50000"
export DRY_RUN="true"   # set to false to actually raise the TTL
node ttl-too-low.js
```

## Test

The pure decision function `assess_ttl_risk` / `assessTtlRisk` takes the
record's TTL and an estimated count of daily unique resolvers, and does no
DNS I/O and no network calls. No credentials or DNS library are required
to run the tests.

```bash
# Python
cd python
pytest test_ttl_risk.py

# Node.js
cd node
node --test
```
