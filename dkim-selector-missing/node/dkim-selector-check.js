/**
 * Detect a missing or stale DKIM selector record and repair it via Cloudflare.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

const DEFAULT_SELECTORS = ["google", "selector1", "selector2", "k1", "s1"];

export function evaluateDkimSelector(txtAnswers, expectedSelector, expectedPubkeyFragment) {
  // Pure decision function. No network, no I/O.
  // txtAnswers is the list of TXT strings already resolved for
  // selector._domainkey.domain (empty array if NXDOMAIN or no answer).
  if (!txtAnswers || txtAnswers.length === 0) {
    return { status: "missing", reason: `no TXT record found for selector '${expectedSelector}'` };
  }

  const value = txtAnswers[0];
  if (!value.startsWith("v=DKIM1")) {
    return { status: "stale", reason: "record exists but does not start with v=DKIM1" };
  }

  if (expectedPubkeyFragment && !value.includes(expectedPubkeyFragment)) {
    return { status: "stale", reason: "record exists but public key does not match the expected key" };
  }

  return { status: "ok", reason: "record is present and matches expectations" };
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");

  const domain = process.env.DNS_DOMAIN;
  const selectors = (process.env.DKIM_SELECTORS || DEFAULT_SELECTORS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
  const expectedPubkeyFragment = process.env.DKIM_PUBKEY_FRAGMENT || null;
  const newRecordValue = process.env.DKIM_RECORD_VALUE;
  const ttl = Number(process.env.RECORD_TTL || 3600);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const resolverIps = ["8.8.8.8", "1.1.1.1"];

  for (const selector of selectors) {
    const name = `${selector}._domainkey.${domain}`;
    const results = {};

    for (const ip of resolverIps) {
      const resolver = new dns.promises.Resolver();
      resolver.setServers([ip]);
      try {
        const records = await resolver.resolveTxt(name);
        results[ip] = records.map((chunks) => chunks.join(""));
      } catch (err) {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
          results[ip] = [];
        } else {
          throw err;
        }
      }
    }

    const txtAnswers = results["8.8.8.8"] || [];
    const outcome = evaluateDkimSelector(txtAnswers, selector, expectedPubkeyFragment);
    console.log(`Selector ${selector} (${name}): ${outcome.status} -> ${outcome.reason}`);

    if (JSON.stringify(results["8.8.8.8"]) !== JSON.stringify(results["1.1.1.1"])) {
      console.warn(`Selector ${selector} disagrees between resolvers, likely propagation in progress`);
    }

    if (outcome.status === "ok") continue;
    if (!newRecordValue) {
      console.log(`No DKIM_RECORD_VALUE set, skipping repair for ${selector}.`);
      continue;
    }

    console.log(`${dryRun ? "Would" : "Will"} create/update TXT record for ${name}.`);
    if (dryRun) continue;

    const lookupRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!lookupRes.ok) throw new Error(`Cloudflare lookup returned ${lookupRes.status}`);
    const lookupBody = await lookupRes.json();
    const existing = lookupBody.result || [];

    const payload = { type: "TXT", name, content: newRecordValue, ttl };
    const url = existing.length
      ? `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing[0].id}`
      : `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
    const method = existing.length ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
    console.log(`Published DKIM TXT record for ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
