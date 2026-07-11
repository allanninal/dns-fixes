/**
 * Detect duplicate v=spf1 TXT records on a domain, and optionally
 * repair the zone via Cloudflare by merging them into one record.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

const ALL_QUALIFIERS = new Set(["-all", "~all", "+all", "all", "?all"]);
const QUALIFIER_STRENGTH = { "-all": 3, "~all": 2, "?all": 1, "+all": 0, all: 0 };

export function mergeSpfRecords(spfStrings) {
  // Pure decision function. No I/O.
  //
  // spfStrings: array of raw TXT record strings, each starting with "v=spf1".
  //
  // Returns null if the list is empty, returns the single string unchanged
  // if there is only one, and if there are two or more, merges every
  // mechanism and modifier from all of them into one new "v=spf1 ..."
  // string, de-duplicated and ending with the strictest "all" qualifier
  // found across the inputs.
  const records = (spfStrings || [])
    .map((s) => (s || "").trim())
    .filter((s) => s.startsWith("v=spf1"));

  if (records.length === 0) return null;
  if (records.length === 1) return records[0];

  const merged = [];
  const seen = new Set();
  let strongestQualifier = "?all";

  for (const record of records) {
    const tokens = record.split(/\s+/).slice(1); // drop the leading "v=spf1"
    for (const token of tokens) {
      if (ALL_QUALIFIERS.has(token)) {
        if ((QUALIFIER_STRENGTH[token] || 0) > (QUALIFIER_STRENGTH[strongestQualifier] || 0)) {
          strongestQualifier = token;
        }
        continue;
      }
      if (!seen.has(token)) {
        seen.add(token);
        merged.push(token);
      }
    }
  }

  const finalQualifier = strongestQualifier === "-all" || strongestQualifier === "?all"
    ? "-all"
    : strongestQualifier;
  return "v=spf1 " + [...merged, finalQualifier].join(" ");
}

async function querySpfRecords(domain) {
  const dns = await import("node:dns/promises");
  const records = await dns.resolveTxt(domain);
  return records
    .map((chunks) => chunks.join(""))
    .filter((text) => text.startsWith("v=spf1"));
}

async function listSpfTxtRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: "TXT", name: domain, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result
    .filter((rec) => rec.content.replace(/^"|"$/g, "").startsWith("v=spf1"))
    .map((rec) => ({ id: rec.id, content: rec.content }));
}

async function deleteRecord(recordId) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  if (DRY_RUN) {
    console.log(`[dry run] would delete record ${recordId}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Cloudflare delete returned ${res.status}`);
  console.log(`Deleted record ${recordId}`);
}

async function createTxtRecord(domain, content) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would create merged TXT record: ${content}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "TXT", name: domain, content, ttl: 1 }),
  });
  if (!res.ok) throw new Error(`Cloudflare create returned ${res.status}`);
  console.log(`Created merged record: ${content}`);
}

async function run() {
  const records = await querySpfRecords(DNS_DOMAIN);
  if (records.length <= 1) {
    console.log(`No duplicate SPF records found for ${DNS_DOMAIN} (${records.length} found).`);
    return;
  }

  console.warn(`${DNS_DOMAIN} has ${records.length} v=spf1 TXT records, permerror risk.`);
  const merged = mergeSpfRecords(records);
  console.log(`Merged record: ${merged}`);

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  const zoneRecords = await listSpfTxtRecords(DNS_DOMAIN);
  for (const rec of zoneRecords) {
    await deleteRecord(rec.id);
  }
  await createTxtRecord(DNS_DOMAIN, merged);
  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
