/**
 * Detect DNSSEC stuck on pending after a domain transfer-in.
 * Diagnostic only: adding or removing a DS record is a registry level action
 * taken through the registrar's portal or EPP, not something the Cloudflare
 * DNS API can touch, so this script never writes anything.
 *
 * Environment:
 *   DNS_DOMAIN               domain to check (default: example.com)
 *   CLOUDFLARE_API_TOKEN     accepted for consistency with the other fixes
 *                            in this repo, unused (see note in run())
 *   CLOUDFLARE_ZONE_ID       accepted for consistency with the other fixes
 *                            in this repo, unused (see note in run())
 *   DRY_RUN                  default "true"; this script never writes
 *                            regardless of this flag
 *   HOURS_SINCE_TRANSFER     how long ago the transfer completed (default: 72)
 *   PENDING_THRESHOLD_HOURS  how long to wait before flagging as stuck (default: 48)
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const HOURS_SINCE_TRANSFER = Number(process.env.HOURS_SINCE_TRANSFER || 72);
const PENDING_THRESHOLD_HOURS = Number(process.env.PENDING_THRESHOLD_HOURS || 48);

/**
 * Pure decision logic, no I/O.
 *
 * cdsDigest: digest string parsed from the child's CDS record (or null if absent)
 * cdnskeyPresent: whether a CDNSKEY record is published at the child
 * parentDsDigests: array of digest strings currently published as DS at the parent/registry
 * hoursSinceTransfer: elapsed time since the transfer-in completed
 * pendingThresholdHours: how long to wait before flagging as stuck (registrars
 *   typically poll every 24-48h)
 *
 * Returns one of: "ok" (DS matches child's signal), "not_signed" (no CDS/CDNSKEY,
 * nothing to publish), "pending_ok" (mismatch but still within normal propagation
 * window), "stuck_pending" (mismatch beyond threshold, registrar action needed),
 * "orphaned_ds" (DS exists at parent but child has no CDS/CDNSKEY at all)
 */
export function dsState(cdsDigest, cdnskeyPresent, parentDsDigests, hoursSinceTransfer,
  pendingThresholdHours = 48.0) {
  if (!cdsDigest && !cdnskeyPresent) {
    return parentDsDigests.length ? "orphaned_ds" : "not_signed";
  }
  if (cdsDigest && parentDsDigests.includes(cdsDigest)) {
    return "ok";
  }
  if (hoursSinceTransfer < pendingThresholdHours) {
    return "pending_ok";
  }
  return "stuck_pending";
}

async function getChildSignals(domain) {
  // The built-in dns module, read-only.
  const dns = await import("node:dns/promises");
  const resolver = new dns.Resolver();

  let cdsDigest = null;
  try {
    const records = await resolver.resolve(domain, "CDS");
    const parts = String(records[0]).trim().split(/\s+/);
    cdsDigest = parts[parts.length - 1].toLowerCase();
  } catch {
    // no CDS published, leave as null
  }

  let cdnskeyPresent = false;
  try {
    await resolver.resolve(domain, "CDNSKEY");
    cdnskeyPresent = true;
  } catch {
    // no CDNSKEY published
  }

  return { cdsDigest, cdnskeyPresent };
}

async function getParentDsDigests(domain) {
  // The built-in dns module, read-only.
  const dns = await import("node:dns/promises");
  const resolver = new dns.Resolver();

  try {
    const records = await resolver.resolve(domain, "DS");
    return records.map((r) => String(r).trim().split(/\s+/).pop().toLowerCase());
  } catch {
    return [];
  }
}

export async function run() {
  console.log(`Checking DNSSEC delegation for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const { cdsDigest, cdnskeyPresent } = await getChildSignals(DNS_DOMAIN);
  const parentDsDigests = await getParentDsDigests(DNS_DOMAIN);

  console.log(`Child CDS digest: ${cdsDigest}`);
  console.log(`Child CDNSKEY present: ${cdnskeyPresent}`);
  console.log(`Parent DS digests: ${JSON.stringify(parentDsDigests)}`);

  const state = dsState(cdsDigest, cdnskeyPresent, parentDsDigests,
    HOURS_SINCE_TRANSFER, PENDING_THRESHOLD_HOURS);

  if (state === "ok") {
    console.log("OK: the parent DS record matches the zone's current key. Nothing to do.");
  } else if (state === "not_signed") {
    console.log("NOT SIGNED: the zone publishes no CDS/CDNSKEY and the parent has no DS. Nothing to reconcile yet.");
  } else if (state === "pending_ok") {
    console.log(
      `PENDING (normal): the DS does not match yet, but only ${HOURS_SINCE_TRANSFER} hour(s) have ` +
      "passed since the transfer. Registrars typically poll every 24-48 hours. Check again later."
    );
  } else if (state === "orphaned_ds") {
    console.warn(
      "ORPHANED DS: the registry still has a DS record but the zone publishes no " +
      "CDS/CDNSKEY at all. Contact the registrar to remove the orphaned DS record."
    );
  } else {
    console.warn(
      `STUCK PENDING: ${HOURS_SINCE_TRANSFER} hour(s) have passed since the transfer and the ` +
      "parent DS still does not match the zone's CDS. This is a registrar-side fix, not " +
      "something the Cloudflare DNS API can change. Add or correct the DS record in the new " +
      "registrar's DNSSEC dashboard using the CDS/CDNSKEY values shown at the DNS host."
    );
  }

  // Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
  // accepted for consistency with the other fixes in this repo, and would be
  // used to manage records inside a zone already delegated to Cloudflare via
  // https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but that
  // endpoint only manages zone records like A/CNAME/TXT, not registry level DS
  // delegation, so this script never calls it.
  if (!DRY_RUN) {
    console.log("DRY_RUN is false, but this check never writes. Fix the DS record at the registrar by hand.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
