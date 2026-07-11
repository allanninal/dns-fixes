# TLS certificate SAN or hostname mismatch

The server presented a TLS certificate whose Subject Alternative Name (SAN) list does not include the hostname the client actually requested. Browsers and TLS libraries ignore the old Common Name field entirely and only trust the SAN dNSName entries, so any hostname missing from that list fails the handshake with an error like ERR_CERT_COMMON_NAME_INVALID, even on a certificate that is otherwise valid and unexpired.

Full write-up with diagrams: https://www.allanninal.dev/dns/tls-san-hostname-mismatch/

## What this does

- Opens a TLS connection with SNI set to the target hostname and reads the SAN dNSName entries off the certificate the server actually serves for that name.
- Checks whether the hostname is covered using a pure, I/O-free decision function, `san_covers_hostname` (Python) / `sanCoversHostname` (Node), that handles exact matches and RFC 6125 leftmost-label wildcard matches.
- If the hostname is missing and Cloudflare credentials are set, repairs it by adding the hostname to an existing Advanced Certificate pack's `hosts` array through the Cloudflare API.
- Safe by default. `DRY_RUN` defaults to `true`, so it only reports the plan until you explicitly turn it off.

## Run it

### Python

```bash
cd python
pip install requests

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"        # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"         # only needed for repair
export CLOUDFLARE_CERT_PACK_ID="your cert pack id"  # only needed for repair
export DRY_RUN="true"                            # set to "false" to actually write

python tls_san_hostname_mismatch.py
```

### Node.js

```bash
cd node

export DNS_DOMAIN="app.example.com"
export CLOUDFLARE_API_TOKEN="your token"        # only needed for repair
export CLOUDFLARE_ZONE_ID="your zone id"         # only needed for repair
export CLOUDFLARE_CERT_PACK_ID="your cert pack id"  # only needed for repair
export DRY_RUN="true"                            # set to "false" to actually write

node tls-san-hostname-mismatch.js
```

## Test

The pure decision function, `san_covers_hostname` (Python) / `sanCoversHostname` (Node), is tested with plain string/list fixtures and needs no network access or TLS handshake.

```bash
# Python
cd python
pip install pytest
pytest -v

# Node.js
cd node
node --test
```
