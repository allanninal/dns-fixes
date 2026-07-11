# DKIM TXT record malformed or wrapped in quotes

A DKIM public key is usually 300 to 800 or more characters long, but a
single DNS TXT character-string is capped at 255 characters by RFC 1035, so
long keys are published as several quoted strings inside one TXT record
that resolvers concatenate back together. When the key is copy-pasted by
hand into a DNS host's web form, it is easy to carry along the literal
quote characters, split the key across two separate TXT records instead of
one record with multiple strings, or leave a stray space or newline in the
base64 body. Any of these corrupts the `p=` value so it no longer decodes
as a valid key, even though the record still resolves and looks present.
This script resolves a selector's TXT record, joins the character-strings
the way a resolver would, flags embedded quotes or a broken base64 body,
and, when told to repair, deletes the broken record and republishes a
corrected one through the Cloudflare API.

Guide: https://www.allanninal.dev/dns/dkim-txt-record-malformed/

## Run it

### Python

```bash
cd python
pip install dnspython requests cryptography
export DNS_DOMAIN="example.com"
export DKIM_SELECTOR="selector1"
export DKIM_RECORD_VALUE="v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG..."
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually delete and recreate the record
python dkim_txt_check.py
```

### Node.js

```bash
cd node
export DNS_DOMAIN="example.com"
export DKIM_SELECTOR="selector1"
export DKIM_RECORD_VALUE="v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG..."
export CLOUDFLARE_API_TOKEN="your token"
export CLOUDFLARE_ZONE_ID="your zone id"
export DRY_RUN="true"   # set to false to actually delete and recreate the record
node dkim-txt-check.js
```

## Test

The pure decision function `validate_dkim_txt` / `validateDkimTxt` takes a
plain list of TXT character-strings and returns a plain result. No network,
no DNS library, no Cloudflare credentials required to run the tests.

```bash
# Python
cd python
pytest test_malformed.py

# Node.js
cd node
node --test
```
