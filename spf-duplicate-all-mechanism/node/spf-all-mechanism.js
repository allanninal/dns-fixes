/**
 * Detect a duplicate or misplaced all mechanism in an SPF record and
 * optionally repair it via Cloudflare. Safe by default. Set DRY_RUN=false
 * to let it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * Input: raw SPF TXT record string, e.g.
 *   'v=spf1 include:_spf.google.com ~all include:sendgrid.net -all'
 *
 * Output: {
 *   ok: boolean,
 *   allCount: number,
 *   allPositionOk: boolean,     // true if the (first) all-token is the last token
 *   unreachableTokens: string[],// tokens after the first all-token
 *   issue: string | null        // 'duplicate_all' | 'all_not_last' | null
 * }
 */
export function checkSpfAllMechanism(spfRecord) {
  let tokens = spfRecord.trim().split(/\s+/);
  if (tokens.length && tokens[0].toLowerCase() === "v=spf1") {
    tokens = tokens.slice(1);
  }

  const allIndexes = [];
  tokens.forEach((t, i) => {
    if (t.replace(/^[+\-~?]/, "").toLowerCase() === "all") allIndexes.push(i);
  });
  const allCount = allIndexes.length;

  if (allCount === 0) {
    return { ok: false, allCount: 0, allPositionOk: false, unreachableTokens: [], issue: "all_not_last" };
  }

  const firstAllIndex = allIndexes[0];
  const allPositionOk = firstAllIndex === tokens.length - 1;
  const unreachableTokens = tokens.slice(firstAllIndex + 1);

  let issue = null;
  if (allCount > 1) issue = "duplicate_all";
  else if (!allPositionOk) issue = "all_not_last";

  return { ok: issue === null, allCount, allPositionOk, unreachableTokens, issue };
}

/** Rebuild a corrected record: dedupe/move all to the end with the chosen qualifier. */
export function rebuildSpfRecord(spfRecord, qualifier = "-") {
  let tokens = spfRecord.trim().split(/\s+/);
  let prefix = ["v=spf1"];
  if (tokens.length && tokens[0].toLowerCase() === "v=spf1") {
    prefix = [tokens[0]];
    tokens = tokens.slice(1);
  }
  const kept = tokens.filter((t) => t.replace(/^[+\-~?]/, "").toLowerCase() !== "all");
  return [...prefix, ...kept, `${qualifier}all`].join(" ");
}

/** Query TXT records and return the one starting with v=spf1. Requires network. */
async function fetchSpfRecord(domain) {
  const dns = await import("node:dns/promises");
  const records = await dns.resolveTxt(domain);
  for (const chunks of records) {
    const text = chunks.join("");
    if (text.toLowerCase().startsWith("v=spf1")) return text;
  }
  return null;
}

/** Find the SPF TXT record via the Cloudflare API. */
async function findSpfRecordId(domain) {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=TXT&name=${domain}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  for (const record of body.result || []) {
    const content = (record.content || "").toLowerCase();
    if (content.startsWith("v=spf1") || content.startsWith('"v=spf1')) return record.id;
  }
  return null;
}

/** Replace the malformed SPF TXT record with the corrected content. */
async function replaceSpfRecord(domain, recordId, correctedContent) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;

  if (DRY_RUN) {
    console.log(`[dry run] would update TXT record ${recordId} at ${domain} to: ${correctedContent}`);
    return;
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ type: "TXT", name: domain, content: correctedContent }),
  });
  if (!res.ok) throw new Error(`Cloudflare update failed: ${res.status}`);
  console.log(`Updated SPF record for ${domain}`);
}

async function run() {
  const spfRecord = await fetchSpfRecord(DNS_DOMAIN);
  if (!spfRecord) {
    console.warn(`No v=spf1 TXT record found for ${DNS_DOMAIN}`);
    return;
  }

  const result = checkSpfAllMechanism(spfRecord);
  console.log(`SPF for ${DNS_DOMAIN}:`, result);

  if (result.ok) {
    console.log("Nothing to repair.");
    return;
  }

  const corrected = rebuildSpfRecord(spfRecord, "-");
  console.log(`Proposed corrected record: ${corrected}`);

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("Issue found but no Cloudflare credentials set. Skipping repair.");
    return;
  }

  const recordId = await findSpfRecordId(DNS_DOMAIN);
  if (!recordId) {
    console.warn("Could not find the SPF TXT record via the Cloudflare API.");
    return;
  }

  await replaceSpfRecord(DNS_DOMAIN, recordId, corrected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
