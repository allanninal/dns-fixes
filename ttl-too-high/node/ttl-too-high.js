/**
 * Detect a DNS record whose TTL is set high enough to delay an urgent
 * change by hours, and optionally repair the zone via Cloudflare by
 * lowering that record's TTL well ahead of the real change.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 *   SAFE_TTL_SECONDS         TTL to lower flagged records to, default 300
 *   TTL_THRESHOLD_SECONDS    TTL above this is flagged, default 3600
 *   DNS_RECORD_TYPE          record type to check, default "A"
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const SAFE_TTL_SECONDS = Number(process.env.SAFE_TTL_SECONDS || 300);
const TTL_THRESHOLD_SECONDS = Number(process.env.TTL_THRESHOLD_SECONDS || 3600);

const CF_API = "https://api.cloudflare.com/client/v4";

export function classifyTtl(currentTtl, thresholdSeconds) {
  // Pure decision function. No I/O.
  //
  // currentTtl: the record's TTL in seconds, as returned by DNS or the
  //   provider API. A TTL of 1 from some providers means "automatic"
  //   and is treated the same as a safe, already-low TTL.
  // thresholdSeconds: any TTL strictly above this is flagged as risky.
  //
  // Returns one of "safe" or "high_ttl".
  if (currentTtl == null || currentTtl <= 1) return "safe";
  if (currentTtl > thresholdSeconds) return "high_ttl";
  return "safe";
}

async function lookupTtl(domain, recordType = "A") {
  const dns = await import("node:dns/promises");
  const resolver = new dns.Resolver();
  const method = recordType === "AAAA" ? "resolve6" : "resolve4";
  const addresses = await resolver[method](domain, { ttl: true });
  return addresses[0].ttl;
}

async function listZoneRecords(domain, recordType = "A") {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: recordType, name: domain, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result;
}

async function lowerTtl(recordId, domain, recordType, content, newTtl) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would lower record ${recordId} to TTL ${newTtl}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ type: recordType, name: domain, content, ttl: newTtl }),
  });
  if (!res.ok) throw new Error(`Cloudflare patch returned ${res.status}`);
  console.log(`Lowered record ${recordId} to TTL ${newTtl}`);
}

async function run(recordType = process.env.DNS_RECORD_TYPE || "A") {
  const ttl = await lookupTtl(DNS_DOMAIN, recordType);
  const verdict = classifyTtl(ttl, TTL_THRESHOLD_SECONDS);
  console.log(`${recordType} record for ${DNS_DOMAIN} has TTL ${ttl} seconds: ${verdict}`);

  if (verdict === "safe") {
    console.log("TTL is already at or below the safe threshold. No repair needed.");
    return;
  }

  console.warn(
    `TTL of ${ttl} seconds on ${DNS_DOMAIN} is above the ${TTL_THRESHOLD_SECONDS} second threshold. ` +
    `An urgent change to this record could take hours to reach everyone.`,
  );

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  const zoneRecords = await listZoneRecords(DNS_DOMAIN, recordType);
  for (const rec of zoneRecords) {
    await lowerTtl(rec.id, DNS_DOMAIN, recordType, rec.content, SAFE_TTL_SECONDS);
  }
  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
