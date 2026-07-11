# dns-fixes

Small, focused scripts that detect and repair the everyday problems that hit real DNS and Domains stores. Every fix ships in **both Python and Node.js**, is **safe by default** (a `DRY_RUN` flag that defaults to `true`, so it reports before it writes), and has a **pure decision function** with unit tests.

Each fix has a full write-up with diagrams on **[allanninal.dev/dns](https://www.allanninal.dev/dns/)**.

## How the scripts authenticate

The scripts check DNS and domain health with standard libraries, and only need provider credentials for the repair fixes.

```bash
export DNS_DOMAIN="yourdomain.com"
export CLOUDFLARE_API_TOKEN="your token"   # only for repair fixes
export DRY_RUN="true"
```

Python uses `dnspython`, `requests` (WHOIS/RDAP and provider APIs), and the standard `ssl` module. Node uses the built-in `dns` and `tls` modules and `fetch`.

## The fixes

| Fix | What it does | Type | Guide |
| --- | --- | --- | --- |
