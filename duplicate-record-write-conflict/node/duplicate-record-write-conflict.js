/**
 * List DNS records before writing, then create or update instead of
 * blindly POSTing a duplicate. Repairs the write through Cloudflare.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the name to check, e.g. "app.example.com"
 *   DNS_RECORD_TYPE          record type to check, default "A"
 *   DNS_RECORD_CONTENT       desired content, e.g. an IP for an A record
 *   DNS_RECORD_TTL           desired TTL, default 300
 *   DNS_RECORD_PROXIED       "true" or "false", default "false"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "app.example.com";
const DNS_RECORD_TYPE = process.env.DNS_RECORD_TYPE || "A";
const DNS_RECORD_CONTENT = process.env.DNS_RECORD_CONTENT || "203.0.113.10";
const DNS_RECORD_TTL = Number(process.env.DNS_RECORD_TTL || 300);
const DNS_RECORD_PROXIED = (process.env.DNS_RECORD_PROXIED || "false").toLowerCase() === "true";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

export function planDnsWrite(existingRecords, desired) {
  // Pure decision function. No I/O.
  // existingRecords: array of { id, name, type, content, ttl, proxied }
  //                  already at (desired.name, desired.type)
  // desired: { name, type, content, ttl, proxied }
  //
  // Returns one of:
  //   { action: "create", body: desired }
  //   { action: "noop", id }
  //   { action: "update", id, body: { changed fields only } }
  //
  // Pure decision logic, no I/O: given zero existing records -> create;
  // given one existing record identical to desired -> noop; given one
  // existing record differing in content/ttl/proxied -> update with only
  // the diff. (A CNAME-vs-other-type conflict is modeled as a separate
  // existing record at the same name with a different type, which the
  // caller must resolve by choosing which record wins.)
  if (!existingRecords.length) {
    return { action: "create", body: desired };
  }

  const current = existingRecords[0];
  const diff = {};
  for (const field of ["content", "ttl", "proxied"]) {
    if (field in desired && current[field] !== desired[field]) {
      diff[field] = desired[field];
    }
  }

  if (Object.keys(diff).length === 0) {
    return { action: "noop", id: current.id };
  }

  return { action: "update", id: current.id, body: diff };
}

async function resolveViaDns(domain, recordType) {
  // Look up what a public resolver actually returns right now, using the
  // built-in dns module. Informational only, used before deciding what to
  // touch.
  const dns = await import("node:dns");
  const { promises: dnsPromises } = dns;
  try {
    if (recordType === "CNAME") return await dnsPromises.resolveCname(domain);
    return await dnsPromises.resolve4(domain);
  } catch (err) {
    if (err.code === "ENODATA" || err.code === "ENOTFOUND") return [];
    throw err;
  }
}

async function listExistingRecords(name, recordType) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: recordType, "name.exact": name });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({
    id: rec.id,
    name: rec.name,
    type: rec.type,
    content: rec.content,
    ttl: rec.ttl ?? 1,
    proxied: rec.proxied ?? false,
  }));
}

async function createRecord(body) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would create record ${JSON.stringify(body)}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cloudflare create returned ${res.status}`);
  console.log(`Created record ${JSON.stringify(body)}`);
}

async function updateRecord(recordId, body) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would update record ${recordId} with ${JSON.stringify(body)}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cloudflare update returned ${res.status}`);
  console.log(`Updated record ${recordId} with ${JSON.stringify(body)}`);
}

async function run() {
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Nothing to reconcile for ${DNS_DOMAIN}.`);
    return;
  }

  const desired = {
    name: DNS_DOMAIN,
    type: DNS_RECORD_TYPE,
    content: DNS_RECORD_CONTENT,
    ttl: DNS_RECORD_TTL,
    proxied: DNS_RECORD_PROXIED,
  };

  const existing = await listExistingRecords(DNS_DOMAIN, DNS_RECORD_TYPE);
  const plan = planDnsWrite(existing, desired);

  if (plan.action === "noop") {
    console.log(`${DNS_DOMAIN} already matches the desired state. Nothing to do.`);
    return;
  }

  if (plan.action === "create") {
    console.log(`${DNS_DOMAIN} has no existing ${DNS_RECORD_TYPE} record. Creating.`);
    await createRecord(plan.body);
    return;
  }

  console.log(`${DNS_DOMAIN} exists but differs. Updating in place instead of duplicating.`);
  await updateRecord(plan.id, plan.body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
