/**
 * Detect a mismatch between a recreated hosted zone's live nameservers and
 * the nameservers the registrar still has delegated. Diagnostic only:
 * fixing the registrar's delegation is a registrar-portal action, not
 * something the Cloudflare DNS API can do, so this script never writes
 * anything.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function normalizeNs(hostname) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function nsSetsMatch(zoneNs, registrarNs) {
  // Pure function, no I/O. Normalize each hostname and compare as sets.
  const a = new Set(zoneNs.map(normalizeNs));
  const b = new Set(registrarNs.map(normalizeNs));
  if (a.size !== b.size) return false;
  for (const host of a) if (!b.has(host)) return false;
  return true;
}

async function getZoneNs(zoneId) {
  // The provider's own view: the live nameservers the recreated zone was
  // actually assigned. Uses the Cloudflare API here; Route 53 users can
  // swap in aws route53 get-hosted-zone instead.
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Cloudflare zone lookup failed: ${res.status}`);
  const data = await res.json();
  return data.result.name_servers;
}

async function getRegistrarNs(domain) {
  // RDAP is the registry-facing view: what the registrar has delegated.
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP lookup failed: ${res.status}`);
  const data = await res.json();
  return (data.nameservers || []).map((ns) => ns.ldhName).filter(Boolean);
}

export async function run() {
  console.log(`Checking nameserver delegation for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const zoneNs = await getZoneNs(CLOUDFLARE_ZONE_ID);
  const registrarNs = await getRegistrarNs(DNS_DOMAIN);

  console.log("Zone (provider API) nameservers:", [...zoneNs].sort());
  console.log("Registrar (RDAP) nameservers:", [...registrarNs].sort());

  if (nsSetsMatch(zoneNs, registrarNs)) {
    console.log("OK: registrar delegation matches the recreated zone. Nothing to do.");
    return;
  }

  console.warn(
    `MISMATCH: the zone now answers with ${JSON.stringify([...zoneNs].sort())} ` +
    `but the registrar still delegates to ${JSON.stringify([...registrarNs].sort())}. ` +
    "This looks like a hosted zone that was deleted and recreated without updating the " +
    "registrar. Update the nameserver list at the registrar to the zone's current values."
  );

  // Note for future readers: fixing this is a registrar-portal action. The
  // Cloudflare DNS API at https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records
  // only manages records inside a zone already delegated to it, it has no
  // endpoint that can touch what the registrar publishes to the registry.
  if (!DRY_RUN) {
    console.log("DRY_RUN is false, but this check never writes. Fix the registrar by hand.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
