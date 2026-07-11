# Partial nameserver cutover serves split answers

During a nameserver migration, the registrar's delegation can end up listing both
the old provider's nameservers and the new provider's nameservers at once (or a
resolver somewhere still has the old nameserver list cached). Every nameserver
on the list is treated as equally correct, so different resolvers ask whichever
one they reach first. If the old and new zones are not byte-for-byte identical,
those resolvers get different answers for the same domain at the same time.

This script resolves a domain's nameservers, queries each one directly for A,
AAAA, CNAME, MX, and TXT records, and diffs the answers to flag any nameserver
whose records disagree with the majority. That part is read-only and needs no
credentials. If Cloudflare credentials are present and `DRY_RUN` is turned off,
it can also push the majority answer for any mismatched record type into the
new provider's zone through the Cloudflare API, to help close the content gap.
Removing the old nameservers from the registrar delegation is a manual,
registrar-portal step that no DNS provider API can do.

Guide with diagrams and the full write-up:
https://www.allanninal.dev/dns/partial-nameserver-cutover-split-answers/

## Run it

Python:

```bash
cd python
pip install dnspython requests
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for the repair path
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for the repair path
export DRY_RUN="true"                       # start safe, set to false to write
python check_split_answers.py
```

Node.js:

```bash
cd node
export DNS_DOMAIN="example.com"
export CLOUDFLARE_API_TOKEN="your token"   # only needed for the repair path
export CLOUDFLARE_ZONE_ID="your zone id"   # only needed for the repair path
export DRY_RUN="true"                       # start safe, set to false to write
node check-split-answers.js
```

## Test

The decision function, `diff_nameserver_answers` / `diffNameserverAnswers`, is
pure and takes pre-fetched records in, so the tests need no network and no
real domain.

Python:

```bash
cd python
pytest test_partial_cutover.py
```

Node.js:

```bash
cd node
node --test check-split-answers.test.js
```
