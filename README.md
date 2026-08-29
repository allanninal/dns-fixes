# DNS and Domains Fixes

Small, tested Python and Node.js scripts that detect and repair real problems across **DNS and domains**. Missing or wrong records, broken email authentication (SPF, DKIM, DMARC), nameserver and delegation mismatches, TTL and propagation surprises, DNSSEC gaps, certificates and domains about to expire, CAA blocking issuance, and dangling records that invite subdomain takeover.

Every fix is safe by default. The scripts start in a dry run mode that reports what they would do, so you can read the plan before anything writes.

By **[Allan Niñal](https://github.com/allanninal)** — AI Solutions Engineer. I build AI powered tools, data products, and AWS automation.
Full write ups with diagrams for each fix live at **[allanninal.dev/dns](https://www.allanninal.dev/dns/)**.

[![Follow on GitHub](https://img.shields.io/github/followers/allanninal?label=Follow%20%40allanninal&style=social)](https://github.com/allanninal)

## How the scripts work

These scripts check DNS and domain health with standard tools, not a store API. Python uses `dnspython` for lookups, `requests` for RDAP/WHOIS and the provider API, and the `ssl` module for certificates; Node uses the built-in `dns` and `tls` modules and `fetch`. Repairs go through a DNS provider API (Cloudflare, AWS Route 53). The decision logic in every fix is a pure function with no network, so it is unit tested.

## Setup

Set the environment variables a fix needs. You only need provider credentials for the repair fixes; the checks need nothing but a domain name.

```bash
export DNS_DOMAIN="yourdomain.com"
export CLOUDFLARE_API_TOKEN="your token"   # only for repair fixes
export DRY_RUN="true"   # start safe
```

Python needs `pip install requests pytest`. Node needs Node 18 or newer (the scripts use the built-in `fetch`, no packages).

## The fixes

| Fix | What it does | Type | Guide |
|---|---|---|---|
| [registrar-zone-nameserver-mismatch](./registrar-zone-nameserver-mismatch/) | Registrar NS glue differs from the authoritative zone NS set. Script compares WHOIS/RDAP NS against live NS query. | Diagnostic | [Read](https://www.allanninal.dev/dns/registrar-zone-nameserver-mismatch/) |
| [missing-subdomain-delegation-glue](./missing-subdomain-delegation-glue/) | Parent zone lacks NS records delegating a subdomain. Script checks parent zone delegation against child zone SOA/NS. | Diagnostic | [Read](https://www.allanninal.dev/dns/missing-subdomain-delegation-glue/) |
| [partial-nameserver-cutover-split-answers](./partial-nameserver-cutover-split-answers/) | Old and new nameservers both listed at registrar during migration. Script queries each NS directly and diffs responses. | Reconciler | [Read](https://www.allanninal.dev/dns/partial-nameserver-cutover-split-answers/) |
| [hosted-zone-recreated-ns-mismatch](./hosted-zone-recreated-ns-mismatch/) | Deleting and recreating a zone assigns new NS that no longer match registrar delegation. Script cross-checks zone NS against registrar NS. | Reconciler | [Read](https://www.allanninal.dev/dns/hosted-zone-recreated-ns-mismatch/) |
| [missing-address-record-nxdomain](./missing-address-record-nxdomain/) | Hosted zone lacks an address record for the queried name. Script resolves the name and reports the missing record. | Diagnostic | [Read](https://www.allanninal.dev/dns/missing-address-record-nxdomain/) |
| [cname-at-zone-apex](./cname-at-zone-apex/) | A literal CNAME at the root breaks required apex records. Script detects apex CNAME and confirms flattening resolved correctly. | Repair | [Read](https://www.allanninal.dev/dns/cname-at-zone-apex/) |
| [cname-coexistence-violation](./cname-coexistence-violation/) | A CNAME shares a hostname with MX, TXT, or A records, which is invalid. Script scans the zone for coexistence violations. | Diagnostic | [Read](https://www.allanninal.dev/dns/cname-coexistence-violation/) |
| [duplicate-conflicting-records](./duplicate-conflicting-records/) | Two A records or a CNAME plus another type exist at one name causing undefined resolution. Script fetches the record set and flags duplicates. | Diagnostic | [Read](https://www.allanninal.dev/dns/duplicate-conflicting-records/) |
| [cname-to-a-type-change-conflict](./cname-to-a-type-change-conflict/) | Converting a CNAME to an A record fails unless the old record is deleted first. Script orders deletes before creates when reconciling. | Repair | [Read](https://www.allanninal.dev/dns/cname-to-a-type-change-conflict/) |
| [www-apex-mismatch](./www-apex-mismatch/) | Only www or only apex is set up, so the other variant fails to resolve or serves different content. Script resolves both and compares. | Reconciler | [Read](https://www.allanninal.dev/dns/www-apex-mismatch/) |
| [wildcard-catch-all-exposure](./wildcard-catch-all-exposure/) | A broad wildcard resolves every undefined subdomain, masking typos or takeovers. Script enumerates wildcard scope and flags apex-level wildcards. | Diagnostic | [Read](https://www.allanninal.dev/dns/wildcard-catch-all-exposure/) |
| [custom-domain-dns-verification-failure](./custom-domain-dns-verification-failure/) | Apex A records or CNAME target do not match the host's required values (e.g. GitHub Pages). Script checks records against the provider's published values. | Reconciler | [Read](https://www.allanninal.dev/dns/custom-domain-dns-verification-failure/) |
| [dangling-cname-subdomain-takeover](./dangling-cname-subdomain-takeover/) | CNAME target on a cloud provider is deprovisioned or unclaimed. Script resolves the CNAME chain and flags claimable targets. | Diagnostic | [Read](https://www.allanninal.dev/dns/dangling-cname-subdomain-takeover/) |
| [dangling-cname-chain-intermediate-hop](./dangling-cname-chain-intermediate-hop/) | A multi-level CNAME chain has a claimable target partway through, not just at the end. Script follows the full chain, not only the first hop. | Diagnostic | [Read](https://www.allanninal.dev/dns/dangling-cname-chain-intermediate-hop/) |
| [orphaned-records-after-teardown](./orphaned-records-after-teardown/) | A or CNAME records remain pointing at decommissioned infrastructure with no owner. Script diffs zone records against a live infrastructure inventory. | Reconciler | [Read](https://www.allanninal.dev/dns/orphaned-records-after-teardown/) |
| [wildcard-pointing-at-deprovisioned-service](./wildcard-pointing-at-deprovisioned-service/) | A wildcard CNAME targets a third-party service that is gone, exposing every unclaimed subdomain to takeover. Script flags wildcards pointing at takeover-prone services. | Diagnostic | [Read](https://www.allanninal.dev/dns/wildcard-pointing-at-deprovisioned-service/) |
| [rdap-hijack-signal-monitoring](./rdap-hijack-signal-monitoring/) | Registrant, nameserver, or status fields change unexpectedly ahead of an unauthorized transfer. Script polls RDAP and diffs fields over time. | Diagnostic | [Read](https://www.allanninal.dev/dns/rdap-hijack-signal-monitoring/) |
| [caa-blocks-intended-ca](./caa-blocks-intended-ca/) | CAA excludes the CA attempting issuance, causing an authorization error. Script queries CAA and cross-checks against the CA in use. | Diagnostic | [Read](https://www.allanninal.dev/dns/caa-blocks-intended-ca/) |
| [caa-blocks-wildcard-issuance](./caa-blocks-wildcard-issuance/) | CAA fails wildcard cert issuance even though the base domain issues fine. Script evaluates CAA at both apex and wildcard label. | Diagnostic | [Read](https://www.allanninal.dev/dns/caa-blocks-wildcard-issuance/) |
| [caa-lookup-servfail-dnssec](./caa-lookup-servfail-dnssec/) | A CA's CAA check hits SERVFAIL from a broken DNSSEC chain, blocking renewal. Script validates DS, DNSKEY, and RRSIG before issuance. | Diagnostic | [Read](https://www.allanninal.dev/dns/caa-lookup-servfail-dnssec/) |
| [tls-san-hostname-mismatch](./tls-san-hostname-mismatch/) | Served certificate's SAN list does not cover the requested hostname, causing handshake failures. Script opens a TLS connection and checks SAN against hostname. | Diagnostic | [Read](https://www.allanninal.dev/dns/tls-san-hostname-mismatch/) |
| [tls-certificate-expiring](./tls-certificate-expiring/) | Renewal automation fails silently and the certificate lapses. Script opens a TLS connection, reads notAfter, and alerts before expiry. | Diagnostic | [Read](https://www.allanninal.dev/dns/tls-certificate-expiring/) |
| [ds-record-mismatch-ksk-rollover](./ds-record-mismatch-ksk-rollover/) | Registrar's published DS no longer matches the zone's current KSK, breaking validation. Script compares DS at parent against DNSKEY at the zone. | Diagnostic | [Read](https://www.allanninal.dev/dns/ds-record-mismatch-ksk-rollover/) |
| [stale-ds-records-orphaned](./stale-ds-records-orphaned/) | Old DS records were never removed, so validators cannot build a trust chain. Script lists all DS records and flags ones with no matching key. | Diagnostic | [Read](https://www.allanninal.dev/dns/stale-ds-records-orphaned/) |
| [dnssec-pending-transfer-in](./dnssec-pending-transfer-in/) | The DS record never gets added automatically after a transfer, leaving DNSSEC perpetually pending. Script polls DS presence against expected state. | Diagnostic | [Read](https://www.allanninal.dev/dns/dnssec-pending-transfer-in/) |
| [expired-rrsig-signatures](./expired-rrsig-signatures/) | A signing job stalls and RRSIG validity windows lapse, causing bogus or SERVFAIL answers. Script checks RRSIG expiration timestamps against current time. | Diagnostic | [Read](https://www.allanninal.dev/dns/expired-rrsig-signatures/) |
| [spf-exceeds-lookup-limit](./spf-exceeds-lookup-limit/) | Nested include mechanisms push SPF evaluation past 10 lookups, causing PermError. Script recursively counts lookups and flags overage. | Diagnostic | [Read](https://www.allanninal.dev/dns/spf-exceeds-lookup-limit/) |
| [duplicate-spf-records](./duplicate-spf-records/) | Two separate v=spf1 TXT records exist, which must be treated as PermError. Script queries TXT records and counts SPF-prefixed entries. | Repair | [Read](https://www.allanninal.dev/dns/duplicate-spf-records/) |
| [spf-duplicate-all-mechanism](./spf-duplicate-all-mechanism/) | Two all directives in one SPF record break evaluation order. Script parses the SPF record and flags duplicate or misordered mechanisms. | Diagnostic | [Read](https://www.allanninal.dev/dns/spf-duplicate-all-mechanism/) |
| [dkim-selector-missing](./dkim-selector-missing/) | The selector._domainkey record is absent or stale, so signatures cannot verify. Script queries expected selector names and flags absence. | Diagnostic | [Read](https://www.allanninal.dev/dns/dkim-selector-missing/) |
| [dkim-cname-selector-not-published](./dkim-cname-selector-not-published/) | Some providers expect CNAME records for selectors and rotation stalls if missing. Script checks that both selectors resolve as CNAMEs to the provider's target. | Reconciler | [Read](https://www.allanninal.dev/dns/dkim-cname-selector-not-published/) |
| [dkim-txt-record-malformed](./dkim-txt-record-malformed/) | A copy-pasted or unsplit long key invalidates the public key value. Script fetches the TXT record and validates the key parses correctly. | Diagnostic | [Read](https://www.allanninal.dev/dns/dkim-txt-record-malformed/) |
| [dkim-key-stale-after-rotation](./dkim-key-stale-after-rotation/) | DNS still publishes the old public key after a private key rotation, so signatures fail. Script diffs the deployed key against the published TXT. | Reconciler | [Read](https://www.allanninal.dev/dns/dkim-key-stale-after-rotation/) |
| [dmarc-record-missing-or-malformed](./dmarc-record-missing-or-malformed/) | The _dmarc TXT record is absent or missing required tags. Script fetches the record and validates syntax against DMARC tag grammar. | Diagnostic | [Read](https://www.allanninal.dev/dns/dmarc-record-missing-or-malformed/) |
| [dmarc-stuck-at-p-none](./dmarc-stuck-at-p-none/) | A domain never progresses past monitor-only policy, leaving it unprotected from spoofing. Script parses the DMARC record and flags p=none. | Diagnostic | [Read](https://www.allanninal.dev/dns/dmarc-stuck-at-p-none/) |
| [dmarc-rua-reports-not-arriving](./dmarc-rua-reports-not-arriving/) | The rua destination lacks the required third-party authorization record on a different domain. Script checks both the DMARC record and the external auth TXT record. | Diagnostic | [Read](https://www.allanninal.dev/dns/dmarc-rua-reports-not-arriving/) |
| [leftover-mx-records-after-migration](./leftover-mx-records-after-migration/) | Old provider's MX entries remain after migration, splitting or losing mail. Script diffs the live MX set against the intended provider's documented hosts. | Reconciler | [Read](https://www.allanninal.dev/dns/leftover-mx-records-after-migration/) |
| [mx-points-to-dead-host](./mx-points-to-dead-host/) | An MX target no longer accepts SMTP, silently dropping mail. Script resolves each MX host and probes port 25 connectivity. | Repair | [Read](https://www.allanninal.dev/dns/mx-points-to-dead-host/) |
| [mx-target-missing-address-record](./mx-target-missing-address-record/) | The MX target hostname has no address record, so mail bounces. Script resolves each MX host and flags dangling targets. | Diagnostic | [Read](https://www.allanninal.dev/dns/mx-target-missing-address-record/) |
| [mx-record-malformed-target](./mx-record-malformed-target/) | An MX target includes a stray @ or is a bare IP instead of a hostname, violating RFC. Script validates MX target syntax and resolvability. | Repair | [Read](https://www.allanninal.dev/dns/mx-record-malformed-target/) |
| [ttl-too-high](./ttl-too-high/) | A long TTL keeps stale answers cached well after a record change. Script reads live TTL values and flags ones above a safe threshold before cutovers. | Diagnostic | [Read](https://www.allanninal.dev/dns/ttl-too-high/) |
| [ttl-too-low](./ttl-too-low/) | A very short TTL multiplies query load on authoritative servers. Script estimates query volume from TTL and traffic to flag risky low values. | Diagnostic | [Read](https://www.allanninal.dev/dns/ttl-too-low/) |
| [proxied-record-forces-ttl](./proxied-record-forces-ttl/) | Enabling proxy mode forces TTL to automatic regardless of the value sent via API. Script detects TTL and proxy-status mismatches against intended config. | Reconciler | [Read](https://www.allanninal.dev/dns/proxied-record-forces-ttl/) |
| [resolver-answer-inconsistency](./resolver-answer-inconsistency/) | A record's value differs between resolvers from stale caches or partial rollout. Script queries multiple public resolvers in parallel and diffs answers. | Diagnostic | [Read](https://www.allanninal.dev/dns/resolver-answer-inconsistency/) |
| [stale-negative-cache-nxdomain](./stale-negative-cache-nxdomain/) | Resolvers cache a prior NXDOMAIN per the SOA negative TTL even after the record is added. Script queries multiple resolvers to detect stale negative caching. | Diagnostic | [Read](https://www.allanninal.dev/dns/stale-negative-cache-nxdomain/) |
| [domain-expiration-approaching](./domain-expiration-approaching/) | RDAP or WHOIS expiration date falls inside a warning threshold with no renewal triggered. Script checks expiry on a schedule and alerts. | Diagnostic | [Read](https://www.allanninal.dev/dns/domain-expiration-approaching/) |
| [auto-renewal-payment-failure](./auto-renewal-payment-failure/) | Auto-renew is on but billing failed silently, leaving the domain stuck in a grace period. Script polls RDAP status and flags domains stuck past renewal. | Diagnostic | [Read](https://www.allanninal.dev/dns/auto-renewal-payment-failure/) |
| [transfer-lock-blocking-renewal](./transfer-lock-blocking-renewal/) | RDAP shows an approaching expiry plus a clientTransferProhibited lock blocking renewal or transfer. Script parses RDAP status codes and expiration together. | Diagnostic | [Read](https://www.allanninal.dev/dns/transfer-lock-blocking-renewal/) |
| [unowned-record-overwritten](./unowned-record-overwritten/) | An automated DNS tool overwrites or silently reassigns a record it does not own, causing unpredictable drift. Script diffs intended versus live records before writing and checks ownership markers. | Reconciler | [Read](https://www.allanninal.dev/dns/unowned-record-overwritten/) |
| [duplicate-record-write-conflict](./duplicate-record-write-conflict/) | Creating a record where one already exists at that name and type errors out. Script lists existing records before writing and upserts instead of blindly creating. | Reconciler | [Read](https://www.allanninal.dev/dns/duplicate-record-write-conflict/) |
| [stale-acme-challenge-record](./stale-acme-challenge-record/) | A leftover or already-deleted _acme-challenge TXT record leaves certificate renewal stuck in a retry loop. Script detects and clears stale challenge records past a timeout. | Reconciler | [Read](https://www.allanninal.dev/dns/stale-acme-challenge-record/) |
| [api-token-missing-scope](./api-token-missing-scope/) | An API token lacks zone-read or zone-list permission, breaking automated record writes for certificate validation. Script pre-flight-checks token scopes before attempting writes. | Diagnostic | [Read](https://www.allanninal.dev/dns/api-token-missing-scope/) |
| [zone-lookup-failure-for-subdomain](./zone-lookup-failure-for-subdomain/) | Automation cannot auto-detect which hosted zone owns a subdomain, aborting a DNS-01 challenge. Script walks up the label tree to find the correct zone before writing. | Diagnostic | [Read](https://www.allanninal.dev/dns/zone-lookup-failure-for-subdomain/) |
| [false-positive-duplicate-detection](./false-positive-duplicate-detection/) | Dedup logic misflags legitimate multivalue or weighted record sets as duplicates, blocking valid changes. Script replicates correct dedup logic using name, type, and set identifier. | Reconciler | [Read](https://www.allanninal.dev/dns/false-positive-duplicate-detection/) |

More fixes land as the guides are published. Watch or star the repo to follow along.

## Running the tests

The decision logic in every fix is a pure function with no network calls, so the tests run anywhere.

```bash
# Python
pip install pytest
pytest

# Node
node --test
```

## A note on safety

These scripts can change live DNS records through the Cloudflare API. Always run with `DRY_RUN=true` first, read the output, and confirm it is correct before you let a script write. Test against a non-production zone when you can.

## Work with me

Fighting a DNS, email deliverability, or domain problem you would rather hand off? That is what I do.

- GitHub: [github.com/allanninal](https://github.com/allanninal)
- LinkedIn: [in/allanninal](https://www.linkedin.com/in/allanninal/)
- Support the work: [ko-fi.com/allanninal](https://ko-fi.com/allanninal)

## Tests

Every fix ships with its test. Run them locally:

```bash
pip install requests pytest
pytest -q
node --test
```

## License

MIT. Use it, change it, ship it.
