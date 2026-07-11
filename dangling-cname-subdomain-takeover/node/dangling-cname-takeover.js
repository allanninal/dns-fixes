/**
 * Detect a dangling CNAME that enables subdomain takeover, and optionally
 * repair it via Cloudflare by removing the offending record.
 * Safe by default. Set DRY_RUN=false to let it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "promo.example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

// Snippets a provider's "nothing lives here" page tends to contain.
const UNCLAIMED_SIGNATURES = [
  "there isn't a github pages site here",
  "the specified bucket does not exist",
  "no such app",
  "domain mapping not found",
];

/**
 * Pure decision function. No I/O.
 *
 * targetStatus looks like:
 *   { resolves: true, httpStatus: 200, bodySnippet: "..." }
 *
 * Returns one of:
 *   "ok"        - target resolves and does not look unclaimed
 *   "dangling"  - target does not resolve (NXDOMAIN) or the response body
 *                 matches a known "not claimed" signature
 *   "unknown"   - could not tell, treat as needing a human look
 */
export function classifyCnameTarget(targetStatus) {
  if (targetStatus == null) return "unknown";

  if (!targetStatus.resolves) return "dangling";

  const snippet = (targetStatus.bodySnippet || "").toLowerCase();
  for (const signature of UNCLAIMED_SIGNATURES) {
    if (snippet.includes(signature)) return "dangling";
  }

  if (targetStatus.httpStatus == null) return "unknown";

  return "ok";
}

/** Follow the CNAME for domain and probe the final target. Requires network. */
async function resolveCnameChain(domain) {
  const dns = await import("node:dns/promises");

  let target;
  try {
    const answer = await dns.resolveCname(domain);
    target = answer[0];
  } catch {
    return [null, { resolves: false, httpStatus: null, bodySnippet: "" }];
  }

  try {
    await dns.resolve4(target);
  } catch {
    return [target, { resolves: false, httpStatus: null, bodySnippet: "" }];
  }

  try {
    const res = await fetch(`https://${domain}/`);
    const body = await res.text();
    return [target, { resolves: true, httpStatus: res.status, bodySnippet: body.slice(0, 2000) }];
  } catch {
    return [target, { resolves: true, httpStatus: null, bodySnippet: "" }];
  }
}

/** Find the dangling CNAME record via the Cloudflare API. */
async function findCnameRecordId(domain) {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${domain}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  const result = body.result || [];
  return result.length ? result[0].id : null;
}

/** Delete the dangling CNAME record so the name can no longer be claimed against it. */
async function removeDanglingCname(domain, recordId) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;

  if (DRY_RUN) {
    console.log(`[dry run] would delete dangling CNAME record ${recordId} for ${domain}`);
    return;
  }

  const del = await fetch(url, { method: "DELETE", headers });
  if (!del.ok) throw new Error(`Cloudflare delete failed: ${del.status}`);
  console.log(`Deleted dangling CNAME record for ${domain}`);
}

async function run() {
  const [target, status] = await resolveCnameChain(DNS_DOMAIN);
  const verdict = classifyCnameTarget(status);
  console.log(`Subdomain ${DNS_DOMAIN} (target ${target}) classified as: ${verdict}`);

  if (verdict !== "dangling") {
    console.log("Nothing to repair.");
    return;
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("Dangling CNAME found but no Cloudflare credentials set. Skipping repair.");
    return;
  }

  const recordId = await findCnameRecordId(DNS_DOMAIN);
  if (!recordId) {
    console.warn("Could not find the CNAME record via the Cloudflare API.");
    return;
  }

  await removeDanglingCname(DNS_DOMAIN, recordId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
