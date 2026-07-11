# Stale ACME challenge TXT record blocks renewal

ACME DNS-01 validation publishes a one-time token as a TXT record at `_acme-challenge.<domain>`, lets the certificate authority read it, then is supposed to delete it. If the cleanup hook fails, crashes, or is skipped, that old token stays in the zone. On the next renewal the record set holds more than one value, and if a resolver returns the stale one, or nameservers disagree, validation fails with an "incorrect TXT record" or "unauthorized" error.

Full write-up with diagrams: https://www.allanninal.dev/dns/stale-acme-challenge-record/

## What this does

- Lists every TXT record at `_acme-challenge.<domain>` and reads each one's `modified_on` timestamp and content.
- Runs a pure, I/O-free decision function, `find_stale_challenge_records` (Python) / `findStaleChallengeRecords` (Node), that flags any record older than a configurable timeout (default one hour, since a real DNS-01 challenge never takes anywhere near that long), or any record whose content does not match the token currently in flight once it is past a short grace period.
- If stale records are found and Cloudflare credentials are set, repairs the zone by deleting each stale record, leaving only the current challenge value (or nothing) in place.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install dnspython requests

export DNS_DOMAIN="example.com"
export CURRENT_CHALLENGE_TOKEN=""                # set to the in-flight token, or leave empty
export STALE_TIMEOUT_SECONDS="3600"
export CLOUDFLARE_API_TOKEN="your token"         # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"         # only needed for repair
export DRY_RUN="true"                            # set to "false" to actually write

python stale_acme_challenge_record.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="example.com"
export CURRENT_CHALLENGE_TOKEN=""                # set to the in-flight token, or leave empty
export STALE_TIMEOUT_SECONDS="3600"
export CLOUDFLARE_API_TOKEN="your token"         # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"         # only needed for repair
export DRY_RUN="true"                            # set to "false" to actually write

node stale-acme-challenge-record.js
```

## Test

The pure decision function, `find_stale_challenge_records` (Python) / `findStaleChallengeRecords` (Node), is tested with plain dict/object fixtures and needs no network access.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
