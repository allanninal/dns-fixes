/**
 * Detect duplicate or conflicting DNS records at a single name, and
 * optionally repair the zone via Cloudflare.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the name to check, e.g. "app.example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   EXPECTED_IPS             comma separated list of IPs allowed for
 *                            A/AAAA records at this name (round robin ok)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const EXPECTED_IPS = (process.env.EXPECTED_IPS || "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

export function detectDuplicateConflict(records, expectedIps = []) {
  // Pure decision function. No I/O.
  // records: array of { type, name, content, id }
  // expectedIps: optional array of IPs allowed for A/AAAA records at this
  // name (an intentional round robin set).
  const expected = new Set(expectedIps);
  const groups = new Map();
  for (const rec of records) {
    if (!groups.has(rec.name)) groups.set(rec.name, []);
    groups.get(rec.name).push(rec);
  }

  for (const [, group] of groups) {
    const hasCname = group.some((r) => r.type === "CNAME");
    if (hasCname && group.length > 1) {
      const toRemove = group.filter((r) => r.type !== "CNAME").map((r) => r.id);
      return { conflict: true, reason: "cname_coexistence", toRemove };
    }

    for (const rtype of ["A", "AAAA"]) {
      const sameType = group.filter((r) => r.type === rtype);
      if (sameType.length < 2) continue;
      if (expected.size > 0 && sameType.some((r) => !expected.has(r.content))) {
        const toRemove = sameType.filter((r) => !expected.has(r.content)).map((r) => r.id);
        return { conflict: true, reason: "ambiguous_duplicate_ip", toRemove };
      }
    }
  }

  return { conflict: false, reason: "", toRemove: [] };
}

async function listZoneRecords(name) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ per_page: "5000" });
  if (name) params.set("name", name);
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({
    name: rec.name, type: rec.type, content: rec.content, id: rec.id,
  }));
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

async function run() {
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Nothing to check for ${DNS_DOMAIN}.`);
    return;
  }

  const records = await listZoneRecords(DNS_DOMAIN);
  const result = detectDuplicateConflict(records, EXPECTED_IPS);

  if (!result.conflict) {
    console.log(`No duplicate or conflicting records found for ${DNS_DOMAIN}.`);
    return;
  }

  console.warn(
    `${DNS_DOMAIN} has a conflict (${result.reason}), ${result.toRemove.length} record(s) to remove`,
  );
  for (const recordId of result.toRemove) {
    await deleteRecord(recordId);
  }

  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
