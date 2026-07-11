/**
 * Detect a literal CNAME at a zone apex and optionally repair it via Cloudflare.
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN             the zone apex to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID     Cloudflare zone id (only needed for repair)
 *   REPLACEMENT_IP         IP address to use for the replacement A record
 *   DRY_RUN                default "true"; set to "false" to actually write
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
 * apexRecords looks like:
 *   { CNAME: ["target.example.net"], NS: [...], SOA: [...], A: [] }
 *
 * Returns one of:
 *   "ok"                     - no CNAME present, NS and SOA present
 *   "conflict_literal_cname" - CNAME present and NS/SOA missing or empty
 *   "flattened_ok"           - CNAME configured upstream but A/AAAA plus
 *                              NS/SOA are intact (provider flattening works)
 */
export function classifyApexCnameConflict(apexRecords) {
  const cname = apexRecords.CNAME || [];
  const ns = apexRecords.NS || [];
  const soa = apexRecords.SOA || [];
  const a = apexRecords.A || [];
  const aaaa = apexRecords.AAAA || [];

  if (cname.length === 0) {
    if (ns.length && soa.length) return "ok";
    return "conflict_literal_cname";
  }

  if (ns.length && soa.length && (a.length || aaaa.length)) {
    return "flattened_ok";
  }

  return "conflict_literal_cname";
}

/** Query CNAME, A, AAAA, NS, and SOA at the zone apex. Requires network. */
async function queryApexRecords(domain) {
  const dns = await import("node:dns/promises");
  const types = ["CNAME", "A", "AAAA", "NS", "SOA"];
  const records = {};
  for (const type of types) {
    try {
      const answer = await dns.resolve(domain, type);
      records[type] = answer.map((r) => (typeof r === "string" ? r : JSON.stringify(r)));
    } catch {
      records[type] = [];
    }
  }
  return records;
}

/** Find the offending CNAME record via the Cloudflare API. */
async function findApexCnameRecordId(domain) {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${domain}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  const result = body.result || [];
  return result.length ? result[0].id : null;
}

/** Delete the literal apex CNAME and create an A record instead. */
async function replaceApexCname(domain, recordId, replacementIp) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const base = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`;

  if (DRY_RUN) {
    console.log(`[dry run] would delete CNAME record ${recordId} at ${domain}`);
    console.log(`[dry run] would create A record ${domain} -> ${replacementIp}`);
    return;
  }

  const del = await fetch(`${base}/${recordId}`, { method: "DELETE", headers });
  if (!del.ok) throw new Error(`Cloudflare delete failed: ${del.status}`);

  const create = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "A", name: domain, content: replacementIp, ttl: 300, proxied: false }),
  });
  if (!create.ok) throw new Error(`Cloudflare create failed: ${create.status}`);
  console.log(`Replaced apex CNAME with A record ${domain} -> ${replacementIp}`);
}

async function run() {
  const records = await queryApexRecords(DNS_DOMAIN);
  const verdict = classifyApexCnameConflict(records);
  console.log(`Apex ${DNS_DOMAIN} classified as: ${verdict}`);

  if (verdict !== "conflict_literal_cname") {
    console.log("Nothing to repair.");
    return;
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("Conflict found but no Cloudflare credentials set. Skipping repair.");
    return;
  }

  const recordId = await findApexCnameRecordId(DNS_DOMAIN);
  if (!recordId) {
    console.warn("Could not find the CNAME record via the Cloudflare API.");
    return;
  }

  const replacementIp = process.env.REPLACEMENT_IP || "203.0.113.10";
  await replaceApexCname(DNS_DOMAIN, recordId, replacementIp);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
