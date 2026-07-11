# DNSSEC stuck pending during a domain transfer-in

After a domain transfers to a new registrar, the DNS zone usually keeps signing without interruption, but the DS record at the registry (the trust anchor the parent zone publishes) is a registrar-only action. If the losing registrar left a stale DS behind, the new registrar's CDS/CDNSKEY scanner has not run yet, or the child's CDS/CDNSKEY records do not match what it expects, the DS never appears and the registrar's dashboard sits on "DNSSEC pending" indefinitely. This script detects the stuck state by comparing the child's CDS/CDNSKEY signals against the parent's DS digests. It is diagnostic only: the fix is a registrar-portal or EPP action, not something the Cloudflare DNS API can perform, since that API only manages zone records like A/CNAME/TXT, not registry level DS delegation.

**Full guide with diagrams:** https://www.allanninal.dev/dns/dnssec-pending-transfer-in/

## Run it

```bash
export DNS_DOMAIN="example.com"
export HOURS_SINCE_TRANSFER="72"          # how long ago the transfer completed
export PENDING_THRESHOLD_HOURS="48"       # how long to wait before flagging as stuck
export DRY_RUN="true"                     # this check never writes regardless

# Python
pip install dnspython requests
python dnssec-pending-transfer-in/python/check_ds_pending.py

# Node
node dnssec-pending-transfer-in/node/check-ds-pending.js
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are accepted for consistency with the other fixes in this repo but are unused, since the Cloudflare DNS API only manages records inside a zone already delegated to it, not the registry's DS delegation.

## Test

```bash
pytest dnssec-pending-transfer-in/python
node --test dnssec-pending-transfer-in/node
```
