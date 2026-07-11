/**
 * Detect a wildcard CNAME pointing at a deprovisioned service and optionally
 * delete it via Cloudflare. Safe by default. Set DRY_RUN=false to let it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

const KNOWN_VULNERABLE_FINGERPRINTS = new Set([
  "no such app",
  "nosuchbucket",
  "there isn't a github pages site here",
  "unrecognized domain",
]);

/**
 * Pure decision function. No I/O.
 *
 * record: object, must have name starting with "*" and type "CNAME".
 * resolvedTargetStatus: one of "NXDOMAIN", "SERVFAIL", "OK", pre-resolved by
 *   the caller.
 * httpFingerprint: a lowercase string from the target's HTTP response, or
 *   null if no request was made.
 * knownVulnerableFingerprints: Set of known "unclaimed resource" strings.
 *
 * Returns true if the wildcard CNAME target is dangling.
 */
export function isDanglingWildcard(record, resolvedTargetStatus, httpFingerprint, knownVulnerableFingerprints) {
  if (!record.name || !record.name.startsWith("*")) return false;
  if (record.type !== "CNAME") return false;
  if (resolvedTargetStatus !== "OK") return true;
  if (knownVulnerableFingerprints.has(httpFingerprint)) return true;
  return false;
}

/** List every CNAME record in the zone via the Cloudflare API. */
async function listCnameRecords() {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  return body.result || [];
}

/** Resolve a CNAME target and classify it as OK, NXDOMAIN, or SERVFAIL. */
async function resolveTargetStatus(hostname) {
  const dns = await import("node:dns/promises");
  try {
    await dns.resolve(hostname, "A");
    return "OK";
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") return "NXDOMAIN";
    return "SERVFAIL";
  }
}

/** Fetch the hostname over HTTPS and return a lowercase fingerprint string. */
async function probeHttpFingerprint(hostname) {
  try {
    const res = await fetch(`https://${hostname}/`, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    return text.toLowerCase();
  } catch {
    return "";
  }
}

/** Delete a dangling wildcard record through the Cloudflare API. */
async function deleteRecord(recordId) {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };

  if (DRY_RUN) {
    console.log(`[dry run] would delete record ${recordId}`);
    return;
  }

  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Cloudflare delete failed: ${res.status}`);
  console.log(`Deleted dangling wildcard record ${recordId}`);
}

async function run() {
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Nothing to scan.");
    return;
  }

  const records = await listCnameRecords();
  let flagged = 0;
  for (const record of records) {
    if (!record.name || !record.name.startsWith("*")) continue;
    const target = record.content || "";
    const status = await resolveTargetStatus(target);
    const fingerprint = status === "OK" ? await probeHttpFingerprint(target) : "";
    const dangling = isDanglingWildcard(record, status, fingerprint, KNOWN_VULNERABLE_FINGERPRINTS);
    if (dangling) {
      console.log(`Wildcard ${record.name} -> ${target} is dangling (${status})`);
      await deleteRecord(record.id);
      flagged++;
    } else {
      console.log(`Wildcard ${record.name} -> ${target} looks fine`);
    }
  }

  console.log(`Done. ${flagged} dangling wildcard(s) ${DRY_RUN ? "to remove" : "removed"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
