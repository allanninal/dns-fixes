/**
 * Detect a missing DMARC third party report authorization record and
 * repair it via Cloudflare. Safe to run on a schedule. Stays in dry
 * run until DRY_RUN=false.
 *
 * Env vars:
 *   DNS_DOMAIN              policy domain that publishes the DMARC record (required)
 *   CLOUDFLARE_API_TOKEN    Cloudflare API token with DNS edit access (required for repair)
 *   CLOUDFLARE_ZONE_ID      Cloudflare zone id that hosts the rua destination domain (required for repair)
 *   DRY_RUN                 "true" (default) or "false"
 */
import { pathToFileURL } from "node:url";

export function parseRuaDomain(dmarcRecordValue) {
  // Pure parser. No network, no I/O.
  for (const part of dmarcRecordValue.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.toLowerCase().startsWith("rua=")) continue;
    const value = trimmed.slice(trimmed.indexOf("=") + 1);
    let first = value.split(",")[0].trim();
    if (first.toLowerCase().startsWith("mailto:")) first = first.slice("mailto:".length);
    if (first.includes("@")) return first.split("@")[1].trim();
  }
  return null;
}

export function needsThirdPartyAuth(policyDomain, ruaDomain, authTxtRecords, wildcardTxtRecords) {
  /**
   * policyDomain: domain publishing the DMARC record (e.g. 'example.com')
   * ruaDomain: domain part of the rua mailto: address (e.g. 'reports.example.net')
   * authTxtRecords: TXT record values found at `${policyDomain}._report._dmarc.${ruaDomain}`
   * wildcardTxtRecords: TXT record values found at `*._report._dmarc.${ruaDomain}`
   * Returns true if authorization is required (domains differ) and missing/invalid in both the
   * specific and wildcard record, meaning reports will be silently dropped.
   */
  if (policyDomain === ruaDomain || ruaDomain.endsWith(`.${policyDomain}`)) {
    return false; // same-domain rua, no third-party auth needed per RFC 7489 7.1
  }
  const hasSpecificAuth = authTxtRecords.some((r) => r.toLowerCase().replace(/ /g, "").includes("v=dmarc1"));
  const hasWildcardAuth = wildcardTxtRecords.some((r) => r.toLowerCase().replace(/ /g, "").includes("v=dmarc1"));
  return !(hasSpecificAuth || hasWildcardAuth);
}

export async function run() {
  // Imported lazily so the pure functions above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");

  const policyDomain = process.env.DNS_DOMAIN;
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const resolver = new dns.promises.Resolver();

  async function txtValues(name) {
    try {
      const answers = await resolver.resolveTxt(name);
      return answers.map((chunks) => chunks.join(""));
    } catch (err) {
      if (err.code === "ENOTFOUND" || err.code === "ENODATA") return [];
      throw err;
    }
  }

  const dmarcName = `_dmarc.${policyDomain}`;
  const dmarcRecords = await txtValues(dmarcName);
  if (dmarcRecords.length === 0) {
    console.warn(`No DMARC record found at ${dmarcName}`);
    return;
  }

  const ruaDomain = parseRuaDomain(dmarcRecords[0]);
  if (ruaDomain === null) {
    console.warn(`No rua tag found in DMARC record at ${dmarcName}`);
    return;
  }

  console.log(`Policy domain ${policyDomain} reports to rua domain ${ruaDomain}`);

  const authName = `${policyDomain}._report._dmarc.${ruaDomain}`;
  const wildcardName = `*._report._dmarc.${ruaDomain}`;
  const authRecords = await txtValues(authName);
  const wildcardRecords = await txtValues(wildcardName);

  if (!needsThirdPartyAuth(policyDomain, ruaDomain, authRecords, wildcardRecords)) {
    console.log("Authorization already satisfied, or same-domain rua. Nothing to do.");
    return;
  }

  console.warn(`Missing authorization record at ${authName}. Reports are being silently dropped.`);
  console.log(`${dryRun ? "Would" : "Will"} create TXT ${authName} = v=DMARC1`);
  if (dryRun) return;

  if (!zoneId || !apiToken) {
    console.error("CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are required to repair.");
    return;
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "TXT", name: authName, content: "v=DMARC1", ttl: 3600 }),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`Created authorization record at ${authName}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
