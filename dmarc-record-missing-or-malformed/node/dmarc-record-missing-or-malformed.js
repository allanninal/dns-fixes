/**
 * Detect a missing, duplicated, or malformed DMARC TXT record at
 * _dmarc.{domain}, and optionally repair it via Cloudflare.
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

const VALID_P_VALUES = new Set(["none", "quarantine", "reject"]);

function defaultRepairContent(domain) {
  return `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${domain}; pct=100`;
}

export function validateDmarcRecord(txtStrings) {
  // Pure decision function. No I/O.
  //
  // txtStrings: array of raw TXT strings found at _dmarc (empty array if none).
  //
  // Returns an object:
  //   { status: "missing" | "duplicate" | "invalid" | "valid",
  //     reason: string | null,
  //     tags: object | null }
  //
  // Checks that exactly one string exists, that it parses per DMARC tag
  // grammar (starts with v=DMARC1, has a p= tag immediately after with an
  // allowed value, and no tag key repeats).
  const strings = txtStrings || [];

  if (strings.length === 0) {
    return { status: "missing", reason: "no TXT record found at _dmarc", tags: null };
  }

  if (strings.length > 1) {
    return { status: "duplicate", reason: "more than one TXT record found at _dmarc", tags: null };
  }

  const raw = strings[0].trim().replace(/^"|"$/g, "");
  const parts = raw.split(";").map((p) => p.trim()).filter((p) => p !== "");

  if (parts.length === 0) {
    return { status: "invalid", reason: "empty record", tags: null };
  }

  const tags = {};
  const order = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      return { status: "invalid", reason: `tag '${part}' has no value`, tags: null };
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (Object.prototype.hasOwnProperty.call(tags, key)) {
      return { status: "invalid", reason: `tag '${key}' appears more than once`, tags: null };
    }
    tags[key] = value;
    order.push(key);
  }

  if (order[0] !== "v" || tags.v !== "DMARC1") {
    return { status: "invalid", reason: "record must start with v=DMARC1", tags };
  }

  if (order.length < 2 || order[1] !== "p") {
    return { status: "invalid", reason: "p= tag must come immediately after v=DMARC1", tags };
  }

  if (!VALID_P_VALUES.has(tags.p)) {
    return { status: "invalid", reason: "p= must be none, quarantine, or reject", tags };
  }

  return { status: "valid", reason: null, tags };
}

async function queryDmarcTxt(domain) {
  const dns = await import("node:dns/promises");
  const name = `_dmarc.${domain}`;
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") return [];
    throw err;
  }
}

async function listDmarcRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: "TXT", name: `_dmarc.${domain}`, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({ id: rec.id, content: rec.content }));
}

async function createDmarcRecord(domain, content) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would create _dmarc TXT record: ${content}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "TXT", name: "_dmarc", content, ttl: 1 }),
  });
  if (!res.ok) throw new Error(`Cloudflare create returned ${res.status}`);
  console.log(`Created _dmarc TXT record: ${content}`);
}

async function updateDmarcRecord(recordId, content) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would update record ${recordId} to: ${content}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ type: "TXT", name: "_dmarc", content, ttl: 1 }),
  });
  if (!res.ok) throw new Error(`Cloudflare update returned ${res.status}`);
  console.log(`Updated record ${recordId} to: ${content}`);
}

async function deleteRecord(recordId) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  if (DRY_RUN) {
    console.log(`[dry run] would delete duplicate record ${recordId}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Cloudflare delete returned ${res.status}`);
  console.log(`Deleted duplicate record ${recordId}`);
}

export async function run() {
  const txtStrings = await queryDmarcTxt(DNS_DOMAIN);
  const result = validateDmarcRecord(txtStrings);

  if (result.status === "valid") {
    console.log(`_dmarc.${DNS_DOMAIN} already has a valid DMARC record. Nothing to do.`);
    return;
  }

  console.warn(`_dmarc.${DNS_DOMAIN} is ${result.status}: ${result.reason}`);

  const repairContent = defaultRepairContent(DNS_DOMAIN);

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  const zoneRecords = await listDmarcRecords(DNS_DOMAIN);
  if (zoneRecords.length === 0) {
    await createDmarcRecord(DNS_DOMAIN, repairContent);
  } else if (zoneRecords.length === 1) {
    await updateDmarcRecord(zoneRecords[0].id, repairContent);
  } else {
    for (const rec of zoneRecords.slice(1)) {
      await deleteRecord(rec.id);
    }
    await updateDmarcRecord(zoneRecords[0].id, repairContent);
  }

  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
