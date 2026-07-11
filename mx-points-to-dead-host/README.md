# MX record points to an unreachable host

A domain's MX record still names a mail host, and DNS still resolves that hostname to an address, but nothing answers on port 25 anymore. This usually happens after a mail provider migration, a server decommission, or a hosting cancellation that never got reflected in DNS. Per RFC 5321, senders only deliver to the addresses in the MX record, so mail queues quietly for 24 to 48 hours against a dead host and then bounces, with no visible error until then.

Full write-up with diagrams: https://www.allanninal.dev/dns/mx-points-to-dead-host/

## What this does

- Resolves the MX records for a domain, in priority order, via dnspython (Python) / the built-in `node:dns` module (Node.js).
- For each MX host, resolves its A/AAAA address and opens a raw TCP socket to port 25 with a short timeout, reading the SMTP banner to classify it as connected, refused, timed out, or non resolving.
- Runs a pure, I/O-free decision function, `classify_mx_health` (Python) / `classifyMxHealth` (Node), that turns those results into a per-host status of `healthy`, `dangling`, or `unreachable`, plus an overall `all_down` flag.
- If every MX host is down and a known-good replacement host is provided, repairs the zone by repointing each MX record at that host through the Cloudflare API (`PATCH /zones/{zone_id}/dns_records/{record_id}`).
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"     # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"     # only needed for repair
export KNOWN_GOOD_MX_HOST="mail2.example.com"  # only needed for repair
export DRY_RUN="true"                        # set to "false" to actually write

python mx_points_to_dead_host.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"     # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"     # only needed for repair
export KNOWN_GOOD_MX_HOST="mail2.example.com"  # only needed for repair
export DRY_RUN="true"                        # set to "false" to actually write

node mx-points-to-dead-host.js
```

## Test

The pure decision function, `classify_mx_health` (Python) / `classifyMxHealth` (Node), is tested with plain fixture data (pre-fetched DNS and socket-probe results) and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
