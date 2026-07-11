/**
 * Detect MX records left behind by a decommissioned mail provider
 * after a migration, and optionally repair the zone via Cloudflare by
 * deleting those leftover records.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   INTENDED_MX_SUFFIXES     comma separated hostname suffixes that
 *                            belong to the intended/current provider,
 *                            e.g. "google.com." or
 *                            "mail.protection.outlook.com."
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const INTENDED_MX_SUFFIXES = (process.env.INTENDED_MX_SUFFIXES || "google.com.")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

function normalize(host) {
  return host.trim().toLowerCase().replace(/\.*$/, "") + ".";
}

export function findLeftoverMx(liveMx, intendedSuffixes) {
  // Pure decision function. No I/O.
  //
  // liveMx: list of [priority, exchangeHost] tuples currently returned
  // by a live MX lookup, e.g.
  // [[1, "smtp.google.com."], [10, "mx1.oldprovider.net."]]
  // intendedSuffixes: list of hostname suffixes that belong to the
  // intended/current provider, e.g. ["google.com."] or
  // ["mail.protection.outlook.com."]
  //
  // Returns the subset of liveMx entries whose exchange host does NOT
  // end with any of the intendedSuffixes (case-insensitive,
  // trailing-dot normalized), i.e. the leftover records from the
  // decommissioned provider that should be deleted.
  const normalizedSuffixes = intendedSuffixes.map(normalize);
  return liveMx.filter(([, exchange]) => {
    const host = normalize(exchange);
    return !normalizedSuffixes.some((suffix) => host.endsWith(suffix));
  });
}

async function fetchMxRecords(domain) {
  const dns = await import("node:dns/promises");
  const records = await dns.resolveMx(domain);
  return records.map((r) => [r.priority, r.exchange]);
}

async function listMxZoneRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: "MX", name: domain, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result;
}

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
  console.log(`Deleted record ${recordId}`);
}

async function run() {
  const liveMx = await fetchMxRecords(DNS_DOMAIN);
  if (liveMx.length === 0) {
    console.log(`No MX records found for ${DNS_DOMAIN}.`);
    return;
  }

  const leftovers = findLeftoverMx(liveMx, INTENDED_MX_SUFFIXES);
  if (leftovers.length === 0) {
    console.log(`All ${liveMx.length} MX record(s) for ${DNS_DOMAIN} match the intended provider.`);
    return;
  }

  for (const [priority, exchange] of leftovers) {
    console.warn(`Leftover MX record for ${DNS_DOMAIN}: priority ${priority} exchange ${JSON.stringify(exchange)}`);
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  const zoneRecords = await listMxZoneRecords(DNS_DOMAIN);
  const leftoverHosts = new Set(leftovers.map(([, exchange]) => normalize(exchange)));
  for (const rec of zoneRecords) {
    if (leftoverHosts.has(normalize(rec.content))) {
      await deleteRecord(rec.id);
    }
  }
  console.log(`Done. ${leftovers.length} leftover record(s) ${DRY_RUN ? "would be removed" : "removed"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
