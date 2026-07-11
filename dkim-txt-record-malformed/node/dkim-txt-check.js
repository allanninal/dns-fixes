/**
 * Detect a malformed DKIM TXT record and repair it via Cloudflare.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

const TAG_RE = /(v|k|p)=([^;]*)/g;

export function validateDkimTxt(strings) {
  // Pure decision function. No network, no I/O.
  // strings is the list of character-strings the built-in dns module
  // returns for the TXT RRset at a selector, e.g.
  // ['v=DKIM1; k=rsa; p=MIIBIjq...', '...rest'].
  if (!strings || strings.length === 0) {
    return { valid: false, reason: "empty_key", keyBytes: null };
  }

  const joined = strings.join("");

  if (joined.includes('"') || joined.includes("\\")) {
    return { valid: false, reason: "embedded_quotes", keyBytes: null };
  }

  const tags = {};
  for (const match of joined.matchAll(TAG_RE)) {
    tags[match[1]] = match[2];
  }
  const pValue = (tags.p || "").trim();

  if (!pValue) {
    return { valid: false, reason: "empty_key", keyBytes: null };
  }

  if (/\s/.test(pValue)) {
    return { valid: false, reason: "embedded_quotes", keyBytes: null };
  }

  try {
    const keyBytes = Buffer.from(pValue, "base64");
    if (keyBytes.toString("base64").replace(/=+$/, "") !== pValue.replace(/=+$/, "")) {
      return { valid: false, reason: "not_base64", keyBytes: null };
    }
    return { valid: true, reason: "ok", keyBytes: keyBytes.length };
  } catch {
    return { valid: false, reason: "not_base64", keyBytes: null };
  }
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network or crypto modules touched at all.
  const dns = await import("node:dns");
  const crypto = await import("node:crypto");

  const domain = process.env.DNS_DOMAIN;
  const selector = process.env.DKIM_SELECTOR || "selector1";
  const newRecordValue = process.env.DKIM_RECORD_VALUE;
  const ttl = Number(process.env.RECORD_TTL || 3600);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const name = `${selector}._domainkey.${domain}`;

  let rrsets = [];
  try {
    const records = await dns.promises.resolveTxt(name);
    rrsets = records;
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") throw err;
  }

  let outcome;
  if (rrsets.length > 1) {
    console.warn(`Selector ${selector} has ${rrsets.length} separate TXT RRsets at the same name (multiple_txt_records)`);
    outcome = { valid: false, reason: "multiple_txt_records", keyBytes: null };
  } else if (rrsets.length === 0) {
    outcome = { valid: false, reason: "empty_key", keyBytes: null };
  } else {
    outcome = validateDkimTxt(rrsets[0]);
  }

  console.log(`Selector ${selector} (${name}): valid=${outcome.valid} reason=${outcome.reason} keyBytes=${outcome.keyBytes}`);

  if (outcome.valid) {
    const joined = rrsets[0].join("");
    const match = /p=([^;]*)/.exec(joined);
    const pValue = match ? match[1].trim() : "";
    try {
      crypto.createPublicKey({
        key: Buffer.from(pValue, "base64"),
        format: "der",
        type: "spki",
      });
      console.log(`Key for ${name} loads as a valid public key.`);
    } catch (exc) {
      console.warn(`Key for ${name} decoded as base64 but did not load as a public key: ${exc.message}`);
    }
    return;
  }

  if (!newRecordValue) {
    console.log(`No DKIM_RECORD_VALUE set, skipping repair for ${selector}.`);
    return;
  }

  console.log(`${dryRun ? "Would" : "Will"} remove the broken record(s) and republish ${name}.`);
  if (dryRun) return;

  const lookupRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!lookupRes.ok) throw new Error(`Cloudflare lookup returned ${lookupRes.status}`);
  const lookupBody = await lookupRes.json();
  const existing = lookupBody.result || [];

  for (const record of existing) {
    const delRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!delRes.ok) throw new Error(`Cloudflare delete returned ${delRes.status}`);
    console.log(`Deleted broken TXT record ${record.id} at ${name}`);
  }

  const createRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "TXT", name, content: newRecordValue, ttl }),
    },
  );
  if (!createRes.ok) throw new Error(`Cloudflare create returned ${createRes.status}`);
  console.log(`Published corrected DKIM TXT record for ${name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
