/**
 * Detect a CNAME coexisting with another record type at the same name,
 * and optionally repair it via Cloudflare.
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN             the name to check, e.g. "app.example.com"
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID     Cloudflare zone id (only needed for repair)
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
 * records: array of { name, type, id }
 *
 * Groups records by lowercased name. For each group, if any record has
 * type "CNAME" and the group has more than one record, returns that name
 * together with the ids and types of every non-CNAME record in the group
 * (these are the ones to remove or relocate).
 *
 * Returns array of { name, conflictingIds, types }.
 */
export function findCnameCoexistenceViolations(records) {
  const groups = new Map();
  for (const rec of records) {
    const key = rec.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const violations = [];
  for (const [name, group] of groups) {
    const hasCname = group.some((r) => r.type === "CNAME");
    if (hasCname && group.length > 1) {
      const others = group.filter((r) => r.type !== "CNAME");
      violations.push({
        name,
        conflictingIds: others.map((r) => r.id),
        types: others.map((r) => r.type),
      });
    }
  }
  return violations;
}

/** Query the common record types at a single name. Requires network. */
async function queryRecordsAtName(domain) {
  const dns = await import("node:dns/promises");
  const rtypes = ["CNAME", "A", "AAAA", "MX", "TXT"];
  const found = [];
  for (const rtype of rtypes) {
    try {
      const answer = await dns.resolve(domain, rtype);
      for (let i = 0; i < answer.length; i++) {
        found.push({ name: domain, type: rtype, id: `${domain}:${rtype}:${i}` });
      }
    } catch {
      continue;
    }
  }
  return found;
}

/** List every DNS record in the Cloudflare zone. */
async function listZoneRecords() {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?per_page=5000`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({ name: rec.name, type: rec.type, id: rec.id }));
}

/** Delete a single DNS record through the Cloudflare API. */
async function deleteRecord(recordId) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;
  if (DRY_RUN) {
    console.log(`[dry run] would delete record ${recordId}`);
    return;
  }
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Cloudflare delete failed: ${res.status}`);
  console.log(`Deleted record ${recordId}`);
}

async function run() {
  let records;
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Checking DNS only for ${DNS_DOMAIN}.`);
    records = await queryRecordsAtName(DNS_DOMAIN);
  } else {
    records = await listZoneRecords();
  }

  const violations = findCnameCoexistenceViolations(records);
  if (violations.length === 0) {
    console.log("No CNAME coexistence violations found.");
    return;
  }

  for (const v of violations) {
    console.warn(
      `${v.name} has a CNAME plus ${v.types.join(", ")} (${v.conflictingIds.length} record(s) to remove or relocate)`,
    );
    if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID) {
      for (const recordId of v.conflictingIds) {
        await deleteRecord(recordId);
      }
    }
  }

  console.log(`Done. ${violations.length} name(s) had a conflict.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
