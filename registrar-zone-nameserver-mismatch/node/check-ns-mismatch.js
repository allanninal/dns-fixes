/**
 * Detect a mismatch between the registrar's delegated nameservers and the
 * nameservers the zone actually answers with. Diagnostic only: the registrar
 * side cannot be fixed through the Cloudflare DNS API, so this script never
 * writes anything, it only reports what it finds.
 *
 * Environment:
 *   DNS_DOMAIN              domain to check (default: example.com)
 *   CLOUDFLARE_API_TOKEN    accepted for consistency with the other fixes
 *                           in this repo, unused (see note in run())
 *   CLOUDFLARE_ZONE_ID      accepted for consistency with the other fixes
 *                           in this repo, unused (see note in run())
 *   DRY_RUN                 default "true"; this script never writes
 *                           regardless of this flag
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function normalizeNs(hostname) {
  // Lowercase and strip a trailing dot so hostnames compare cleanly.
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function nsSetsMatch(registrarNs, zoneNs) {
  // Pure function, no I/O. Normalize each hostname and compare as sets.
  // Order, case, and a trailing dot never matter; a missing or extra
  // server always does.
  const a = new Set(registrarNs.map(normalizeNs));
  const b = new Set(zoneNs.map(normalizeNs));
  if (a.size !== b.size) return false;
  for (const host of a) if (!b.has(host)) return false;
  return true;
}

async function getRegistrarNs(domain) {
  // RDAP is the registry-facing view: what the registrar has delegated.
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP lookup failed: ${res.status}`);
  const data = await res.json();
  return (data.nameservers || []).map((ns) => ns.ldhName).filter(Boolean);
}

async function getZoneNs(domain) {
  // The built-in dns module gives the live, authoritative-side view.
  const dns = await import("node:dns/promises");
  return dns.resolveNs(domain);
}

export async function run() {
  console.log(`Checking nameserver delegation for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const registrarNs = await getRegistrarNs(DNS_DOMAIN);
  const zoneNs = await getZoneNs(DNS_DOMAIN);

  console.log("Registrar (RDAP) nameservers:", [...registrarNs].sort());
  console.log("Zone (live NS query) nameservers:", [...zoneNs].sort());

  if (nsSetsMatch(registrarNs, zoneNs)) {
    console.log("OK: registrar delegation matches the live zone. Nothing to do.");
    return;
  }

  console.warn(
    `MISMATCH: the registrar delegates to ${JSON.stringify([...registrarNs].sort())} ` +
    `but the zone answers with ${JSON.stringify([...zoneNs].sort())}. ` +
    "This is a registrar-side fix, not something the Cloudflare DNS API can change. " +
    "Update the nameserver list at the registrar to match the zone's NS set."
  );

  // Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
  // accepted for consistency with the other fixes in this repo, and would be
  // used to manage records inside a zone already delegated to Cloudflare via
  // https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but that
  // endpoint has no way to touch the registrar's delegation itself, so this
  // script never calls it.
  if (!DRY_RUN) {
    console.log("DRY_RUN is false, but this check never writes. Fix the registrar by hand.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
