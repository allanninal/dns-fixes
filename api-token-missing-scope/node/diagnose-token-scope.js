/**
 * Pre-flight check that runs the same calls a DNS automation makes and
 * reports which permission group is missing, before any real record
 * write is attempted. Safe to run on a schedule or as a CI step ahead
 * of the actual automation.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * Pure decision logic (no I/O): given the parsed JSON bodies already
 * fetched from /user/tokens/verify, /zones?name=..., and
 * /zones/{id}/dns_records, classify the failure.
 * Returns one of: 'ok', 'token_invalid', 'missing_zone_read',
 * 'missing_dns_edit', 'unknown_error'.
 */
export function diagnoseTokenScope(verifyOk, zoneListResponse, dnsReadResponse) {
  if (!verifyOk) return "token_invalid";
  if (!(zoneListResponse && zoneListResponse.success)) return "missing_zone_read";
  if (!(dnsReadResponse && dnsReadResponse.success)) return "missing_dns_edit";
  return "ok";
}

async function cf(path, params) {
  const url = new URL(`https://api.cloudflare.com/client/v4${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}

export async function run() {
  const verify = await cf("/user/tokens/verify");
  const verifyOk = Boolean(verify.success) && verify.result && verify.result.status === "active";
  console.log(`Token verify: ${verifyOk ? "active" : "not active"}`);

  const zoneList = await cf("/zones", { name: DNS_DOMAIN });

  let resolvedZoneId = CLOUDFLARE_ZONE_ID;
  if (zoneList.success && zoneList.result && zoneList.result.length > 0) {
    resolvedZoneId = zoneList.result[0].id;
  }

  let dnsRead = { success: false };
  if (resolvedZoneId) {
    dnsRead = await cf(`/zones/${resolvedZoneId}/dns_records`, {
      type: "TXT",
      name: `_acme-challenge.${DNS_DOMAIN}`,
    });
  }

  const verdict = diagnoseTokenScope(verifyOk, zoneList, dnsRead);

  if (verdict === "ok") {
    console.log("Token has the permissions this automation needs. Safe to proceed.");
    return;
  }

  const messages = {
    token_invalid: "Token is not active. Reissue it in the Cloudflare dashboard.",
    missing_zone_read:
      "Token is missing Zone, Zone, Read (or account-level Zone Read). " +
      "It cannot resolve a domain name to a zone id, so every automation " +
      "run aborts before it ever attempts the DNS write.",
    missing_dns_edit:
      "Token is missing Zone, DNS, Edit for this zone. It can list the " +
      "zone but cannot read or write DNS records in it.",
  };
  console.warn(`Scope problem: ${verdict} -> ${messages[verdict] || "Unknown error, check the raw responses."}`);

  if (DRY_RUN) {
    console.log("Dry run: not attempting a real record write. Fix the token scope, then re-run.");
    return;
  }

  console.log("DRY_RUN is false, but this pre-flight check never writes real automation records itself.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
