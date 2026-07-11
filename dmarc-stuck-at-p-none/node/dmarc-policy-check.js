/**
 * Detect a DMARC record stuck at p=none and repair it via Cloudflare.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function parseDmarcTags(recordValue) {
  // Pure parser. No network, no I/O.
  const tags = {};
  for (const part of recordValue.split(";")) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    tags[key] = value;
  }
  return tags;
}

export function nextDmarcPolicy(recordValue, daysSinceLastChange, spfDkimAlignedPct) {
  // Pure decision function. No network, no I/O.
  const tags = parseDmarcTags(recordValue);

  if (tags.p !== "none") return null;
  if (daysSinceLastChange < 90) return null;
  if (spfDkimAlignedPct < 0.98) return null;

  tags.p = "quarantine";
  tags.pct = "25";
  const order = ["v", "p", "pct", "rua", "ruf", "adkim", "aspf"];
  const orderedKeys = [...order.filter((k) => k in tags), ...Object.keys(tags).filter((k) => !order.includes(k))];
  return orderedKeys.map((k) => `${k}=${tags[k]}`).join("; ");
}

export async function run() {
  // Imported lazily so the pure functions above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");

  const domain = process.env.DNS_DOMAIN;
  const daysSinceLastChange = Number(process.env.DAYS_SINCE_LAST_CHANGE || 0);
  const spfDkimAlignedPct = Number(process.env.SPF_DKIM_ALIGNED_PCT || 0);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const name = `_dmarc.${domain}`;
  const resolver = new dns.promises.Resolver();

  let records = [];
  try {
    const answers = await resolver.resolveTxt(name);
    records = answers.map((chunks) => chunks.join(""));
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") throw err;
  }

  if (records.length === 0) {
    console.warn(`No DMARC record found at ${name}`);
    return;
  }

  const current = records[0];
  const tags = parseDmarcTags(current);
  console.log(`Current record at ${name}: ${current}`);

  if (tags.p !== "none") {
    console.log(`Policy is already ${tags.p}, nothing to do.`);
    return;
  }

  const proposed = nextDmarcPolicy(current, daysSinceLastChange, spfDkimAlignedPct);
  if (proposed === null) {
    console.log(
      `Policy is p=none but it is not safe to advance yet ` +
      `(daysSinceLastChange=${daysSinceLastChange}, spfDkimAlignedPct=${spfDkimAlignedPct}).`
    );
    return;
  }

  console.log(`${dryRun ? "Would" : "Will"} update ${name} to: ${proposed}`);
  if (dryRun) return;

  const lookupRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!lookupRes.ok) throw new Error(`Cloudflare lookup returned ${lookupRes.status}`);
  const lookupBody = await lookupRes.json();
  const existing = lookupBody.result || [];
  if (existing.length === 0) {
    console.warn(`No existing TXT record found to patch for ${name}`);
    return;
  }

  const recordId = existing[0].id;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "TXT", name, content: proposed }),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`Raised DMARC policy for ${name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
