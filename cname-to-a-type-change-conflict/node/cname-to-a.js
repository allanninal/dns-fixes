/**
 * Detect a CNAME left behind at a name where an A record is wanted, and
 * repair it with one atomic Cloudflare PUT instead of a delete-then-create
 * race.
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN             the name to change, e.g. "app.example.com"
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID     Cloudflare zone id (only needed for repair)
 *   DESIRED_A_RECORD_IP    the IP address the A record should point to
 *   DESIRED_TTL            default "300"
 *   DRY_RUN                default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DESIRED_A_RECORD_IP = process.env.DESIRED_A_RECORD_IP || "203.0.113.10";
const DESIRED_TTL = Number(process.env.DESIRED_TTL || 300);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * liveRecords: array of { id, type, content } for the records currently
 * live at the desired name.
 * desired: { name, type, content, ttl }
 *
 * Returns one of:
 *   { action: "noop" }
 *     a record already matches the desired type and content
 *   { action: "overwrite", recordId }
 *     exactly one conflicting record of a different type exists at the
 *     name (for example a CNAME where an A record is wanted); a same
 *     record PUT should replace delete+create
 *   { action: "create" }
 *     no record exists at the name yet
 */
export function planRrsetChange(liveRecords, desired) {
  for (const rec of liveRecords) {
    if (rec.type === desired.type && rec.content === desired.content) {
      return { action: "noop" };
    }
  }

  const conflicting = liveRecords.filter((r) => r.type !== desired.type);
  if (conflicting.length === 1) {
    return { action: "overwrite", recordId: conflicting[0].id };
  }

  if (liveRecords.length === 0) {
    return { action: "create" };
  }

  return { action: "noop" };
}

/** List the DNS records Cloudflare has for a single name. */
async function listRecordsAtName(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${encodeURIComponent(domain)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({ id: rec.id, type: rec.type, content: rec.content }));
}

/** Overwrite an existing record in place with a single PUT call. */
async function overwriteRecord(recordId, domain, ip, ttl) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;
  if (DRY_RUN) {
    console.log(`[dry run] would PUT ${recordId} to type A, content ${ip}`);
    return;
  }
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ type: "A", name: domain, content: ip, ttl }),
  });
  if (!res.ok) throw new Error(`Cloudflare update failed: ${res.status}`);
  console.log(`Overwrote record ${recordId} in place. Now type A, content ${ip}.`);
}

/** Create a new A record. Only used when nothing exists at the name. */
async function createRecord(domain, ip, ttl) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`;
  if (DRY_RUN) {
    console.log(`[dry run] would create A record for ${domain} pointing to ${ip}`);
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "A", name: domain, content: ip, ttl }),
  });
  if (!res.ok) throw new Error(`Cloudflare create failed: ${res.status}`);
  console.log(`Created new A record for ${domain} pointing to ${ip}.`);
}

export async function run() {
  // Imported lazily so this module can be unit tested with no network
  // and no DNS libraries installed.
  const dns = await import("node:dns/promises");

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Cannot check or repair ${DNS_DOMAIN}.`);
    return;
  }

  try {
    const answers = await dns.resolveCname(DNS_DOMAIN);
    console.log(`Resolver still sees a CNAME for ${DNS_DOMAIN}: ${answers[0]}`);
  } catch {
    console.log(`Resolver shows no CNAME for ${DNS_DOMAIN}`);
  }

  const liveRecords = await listRecordsAtName(DNS_DOMAIN);
  const desired = { name: DNS_DOMAIN, type: "A", content: DESIRED_A_RECORD_IP, ttl: DESIRED_TTL };
  const plan = planRrsetChange(liveRecords, desired);
  console.log(`Plan for ${DNS_DOMAIN}:`, plan);

  if (plan.action === "noop") {
    console.log(`Nothing to do. ${DNS_DOMAIN} already matches.`);
    return;
  }

  if (plan.action === "overwrite") {
    await overwriteRecord(plan.recordId, DNS_DOMAIN, DESIRED_A_RECORD_IP, DESIRED_TTL);
  } else if (plan.action === "create") {
    await createRecord(DNS_DOMAIN, DESIRED_A_RECORD_IP, DESIRED_TTL);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
