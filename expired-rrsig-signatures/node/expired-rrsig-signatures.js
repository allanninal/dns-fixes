/**
 * Detect RRSIG signatures that have expired or are close to expiring, and
 * optionally trigger a re-sign through the Cloudflare DNS API. Safe by
 * default. Set DRY_RUN=false to let it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const RECORD_TYPE = process.env.RECORD_TYPE || "A";
const WARN_HOURS = Number(process.env.WARN_HOURS || 48);
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * expiration: Date, the RRSIG record's expiration timestamp
 * now: Date, the current time to compare against
 * warnHours: number, how many hours before expiration counts as "soon"
 *
 * Returns one of "expired", "expiring_soon", or "ok".
 */
export function checkRrsigExpiration(expiration, now, warnHours) {
  const remainingHours = (expiration.getTime() - now.getTime()) / 3600000;
  if (remainingHours <= 0) return "expired";
  if (remainingHours <= warnHours) return "expiring_soon";
  return "ok";
}

/**
 * Query the RRSIG record for a name and return its expiration as a Date.
 * Requires network. Node's built-in dns module does not expose RRSIG
 * directly, so this uses resolveAny and filters for the RRSIG type.
 */
async function queryRrsigExpiration(domain, recordType) {
  const dns = await import("node:dns/promises");
  const records = await dns.resolveAny(domain);
  const rrsig = records.find(
    (r) => r.type === "RRSIG" && r.typeCovered === recordType
  );
  if (!rrsig) throw new Error(`No RRSIG covering ${recordType} found for ${domain}`);
  return new Date(rrsig.expiration * 1000);
}

/** Read the current DNSSEC status for a Cloudflare zone. */
async function getCloudflareDnssecStatus(zoneId, token) {
  const url = `${CF_API}/zones/${zoneId}/dnssec`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC read failed: ${res.status}`);
  const body = await res.json();
  return body.result || {};
}

/**
 * Force Cloudflare to re-assert DNSSEC as active, which triggers a fresh
 * signing pass and issues new RRSIG records with a new expiration.
 */
async function triggerResign(zoneId, token) {
  if (DRY_RUN) {
    console.log(`[dry run] would PATCH DNSSEC status to active for zone ${zoneId}`);
    return;
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = `${CF_API}/zones/${zoneId}/dnssec`;
  const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ status: "active" }) });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC patch failed: ${res.status}`);
  console.log(`Triggered a re-sign for zone ${zoneId}`);
}

async function run() {
  const expiration = await queryRrsigExpiration(DNS_DOMAIN, RECORD_TYPE);
  const now = new Date();
  const state = checkRrsigExpiration(expiration, now, WARN_HOURS);

  if (state === "ok") {
    console.log(`RRSIG for ${DNS_DOMAIN} ${RECORD_TYPE} is valid until ${expiration.toISOString()}.`);
    return;
  }

  console.warn(
    `RRSIG for ${DNS_DOMAIN} ${RECORD_TYPE} is ${state} (expiration ${expiration.toISOString()}, now ${now.toISOString()}).`
  );

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(
      "No Cloudflare credentials set. If this zone uses a self-hosted " +
      "or offline signer, re-sign it manually and reload the zone."
    );
    return;
  }

  const status = await getCloudflareDnssecStatus(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN);
  console.log(`Current Cloudflare DNSSEC status: ${status.status}`);
  await triggerResign(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
