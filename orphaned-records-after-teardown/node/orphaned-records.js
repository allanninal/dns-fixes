/**
 * Detect DNS records left behind after a service teardown, and optionally
 * repair the zone via Cloudflare. Safe by default. Set DRY_RUN=false to let
 * it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const LIVE_INVENTORY = new Set(
  (process.env.LIVE_INVENTORY || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

const UNCLAIMED_FINGERPRINTS = {
  "s3-website-us-east-1.amazonaws.com": "NoSuchBucket",
  "herokuapp.com": "no-such-app",
  "github.io": "There isn't a GitHub Pages site here",
};

/**
 * Pure decision function. No I/O.
 *
 * record: { type: "CNAME"|"A"|"AAAA", name: string, content: string }
 * liveInventory: Set of hostnames/IPs currently provisioned (from a cloud
 *   API or CMDB snapshot), already lowercased with no trailing dot.
 * unclaimedFingerprints: { providerDomainSuffix: expected404BodySubstring }
 *   for known dangling signatures.
 *
 * Returns one of "orphaned", "active", "needs_manual_review".
 */
export function classifyRecord(record, liveInventory, unclaimedFingerprints) {
  const target = record.content.replace(/\.$/, "").toLowerCase();

  if (liveInventory.has(target)) return "active";

  for (const suffix of Object.keys(unclaimedFingerprints)) {
    if (target.endsWith(suffix) && !liveInventory.has(target)) return "orphaned";
  }

  return "needs_manual_review";
}

/** List CNAME, A, and AAAA records in the zone via the Cloudflare API. */
async function listZoneRecords() {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const records = [];
  for (const recordType of ["CNAME", "A", "AAAA"]) {
    const params = new URLSearchParams({ type: recordType, per_page: "5000" });
    const res = await fetch(
      `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
      { headers },
    );
    if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
    const body = await res.json();
    for (const rec of body.result) {
      records.push({ id: rec.id, type: rec.type, name: rec.name, content: rec.content });
    }
  }
  return records;
}

/** Delete a single DNS record through the Cloudflare API. */
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
  console.log(`Deleted orphaned record ${recordId}`);
}

async function run() {
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Nothing to scan for ${DNS_DOMAIN}.`);
    return;
  }

  const records = await listZoneRecords();
  let orphaned = 0;
  for (const record of records) {
    const verdict = classifyRecord(record, LIVE_INVENTORY, UNCLAIMED_FINGERPRINTS);
    if (verdict === "orphaned") {
      console.log(`${record.name} -> ${record.content} is orphaned`);
      await deleteRecord(record.id);
      orphaned++;
    } else if (verdict === "needs_manual_review") {
      console.warn(`${record.name} -> ${record.content} needs manual review`);
    } else {
      console.log(`${record.name} -> ${record.content} is active`);
    }
  }

  console.log(`Done. ${orphaned} orphaned record(s) ${DRY_RUN ? "to remove" : "removed"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
