# Stale negative cache keeps a fixed record unresolvable

The record now exists at the authoritative server, but some resolvers still
answer NXDOMAIN because they cached that "does not exist" answer before the
record was created. Per RFC 2308, the resolver honors the zone's SOA MINIMUM
(the negative-cache TTL) strictly by the clock, not by rechecking the zone,
so the stale answer keeps being served until it naturally expires. This
script confirms the record at the authoritative server, checks a set of
public resolvers directly, flags any still returning a stale NXDOMAIN, and
can optionally lower the zone's negative-cache TTL through the Cloudflare
DNS Settings API so future gaps are shorter.

Guide: https://www.allanninal.dev/dns/stale-negative-cache-nxdomain/

## Run it

### Python

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="newhost.example.com"
export DNS_ZONE="example.com"
export PUBLIC_RESOLVERS="1.1.1.1,8.8.8.8,9.9.9.9"
export CLOUDFLARE_API_TOKEN="your token"     # optional, only needed to lower the negative-cache TTL
export CLOUDFLARE_ZONE_ID="your zone id"     # optional
export DRY_RUN="true"   # set to false to actually lower the zone's negative-cache TTL
python stale_negative_cache.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="newhost.example.com"
export DNS_ZONE="example.com"
export PUBLIC_RESOLVERS="1.1.1.1,8.8.8.8,9.9.9.9"
export CLOUDFLARE_API_TOKEN="your token"     # optional, only needed to lower the negative-cache TTL
export CLOUDFLARE_ZONE_ID="your zone id"     # optional
export DRY_RUN="true"   # set to false to actually lower the zone's negative-cache TTL
node stale-negative-cache.js
```

There is no API call that can evict a cached answer from a resolver you do
not control. The script can only detect the stale state, estimate how long
it will take to self-heal from the SOA TTL it observes, and shorten the
zone's own negative-cache TTL so the next gap is smaller.

## Test

The pure decision function `stale_negative_cache_report` /
`staleNegativeCacheReport` takes plain numbers, a dict/object of tuples, and
a bool. No network, no DNS library, no Cloudflare credentials required to
run the tests.

```bash
# Python
cd python
pytest test_stale.py

# Node.js
cd node
node --test
```
