/**
 * Detect a missing subdomain delegation and repair it in the parent zone.
 *
 * DETECT: query the parent zone's own authoritative nameserver for the NS
 * record set at the subdomain name, and query the child zone's own
 * authoritative nameserver for its NS and SOA records.
 *
 * REPAIR: if the child is live but the parent has no matching NS records,
 * add the missing NS records in the parent zone through the Cloudflare API.
 *
 * Safe to run again and again. Starts in dry run mode.
 *
 * Environment:
 *   DNS_DOMAIN              the subdomain to check, e.g. "app.example.com"
 *   CLOUDFLARE_API_TOKEN    Cloudflare API token (only needed for the repair)
 *   CLOUDFLARE_ZONE_ID      Cloudflare zone id for the PARENT zone
 *   DRY_RUN                 "true" (default) reports only, "false" writes
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "app.example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function isDelegationMissing(parentNsAnswer, childNsAnswer, childSoaPresent) {
  // parentNsAnswer: NS hostnames the parent zone's authoritative server
  //                 returns for the subdomain name (empty array if none).
  // childNsAnswer:  NS hostnames the child zone's own authoritative
  //                 server returns for the same name.
  // childSoaPresent: true if the child zone answers with a valid SOA
  //                  record for the subdomain (the child is actually live).
  // Returns true when the child zone is live and has NS records, but the
  // parent has no NS records for that name, or shares none with the child.
  if (!childSoaPresent || childNsAnswer.length === 0) return false;
  if (parentNsAnswer.length === 0) return true;
  const childSet = new Set(childNsAnswer);
  return !parentNsAnswer.some((ns) => childSet.has(ns));
}

function parentZoneOf(name) {
  const parts = name.replace(/\.$/, "").split(".");
  return parts.slice(1).join(".");
}

async function queryNs(name, nameserver) {
  const dns = await import("node:dns");
  const resolver = new dns.promises.Resolver();
  if (nameserver) resolver.setServers([nameserver]);
  try {
    const records = await resolver.resolveNs(name);
    return records.map((r) => r.replace(/\.$/, "")).sort();
  } catch {
    return [];
  }
}

async function querySoaPresent(name, nameserver) {
  const dns = await import("node:dns");
  const resolver = new dns.promises.Resolver();
  if (nameserver) resolver.setServers([nameserver]);
  try {
    await resolver.resolveSoa(name);
    return true;
  } catch {
    return false;
  }
}

async function findAuthoritativeNs(zone) {
  const dns = await import("node:dns");
  const records = await dns.promises.resolveNs(zone);
  return records.map((r) => r.replace(/\.$/, "")).sort();
}

async function addDelegationRecords(subdomain, childNameservers) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  for (const nsHost of childNameservers) {
    const payload = { type: "NS", name: subdomain, content: nsHost };
    if (DRY_RUN) {
      console.log(`DRY RUN: would create NS record ${subdomain} -> ${nsHost}`);
      continue;
    }
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      { method: "POST", headers, body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
    console.log(`Created NS record ${subdomain} -> ${nsHost}`);
  }
}

export async function run() {
  const subdomain = DNS_DOMAIN;
  const parentZone = parentZoneOf(subdomain);

  const parentAuthoritative = await findAuthoritativeNs(parentZone);
  let parentNsAnswer = [];
  if (parentAuthoritative.length > 0) {
    parentNsAnswer = await queryNs(subdomain, parentAuthoritative[0]);
  }

  const childNsAnswer = await queryNs(subdomain);
  const childSoaPresent = await querySoaPresent(subdomain);

  if (isDelegationMissing(parentNsAnswer, childNsAnswer, childSoaPresent)) {
    console.warn(
      `Missing delegation for ${subdomain}: parent has ${JSON.stringify(parentNsAnswer)}, child has ${JSON.stringify(childNsAnswer)}`,
    );
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
      console.log("No Cloudflare credentials set. Skipping repair, reporting only.");
      return;
    }
    await addDelegationRecords(subdomain, childNsAnswer);
  } else {
    console.log(`Delegation looks fine for ${subdomain}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
