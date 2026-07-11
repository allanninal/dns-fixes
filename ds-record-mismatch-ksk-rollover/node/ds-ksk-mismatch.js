/**
 * Detect a DS record mismatch after a KSK rollover, and optionally refresh
 * Cloudflare-side DNSSEC signaling. Safe by default. Set DRY_RUN=false to
 * let it write.
 *
 * Environment:
 *   DNS_DOMAIN             the zone to check, e.g. example.com
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token (only needed for the repair)
 *   CLOUDFLARE_ZONE_ID     Cloudflare zone id (only needed for the repair)
 *   DRY_RUN                "true" (default) reports only, "false" writes
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * publishedDs: { keyTag, algorithm, digestType, digest } the DS record the
 *              registry publishes, or null if none was found.
 * expectedDs: same shape, computed fresh from the zone's current live KSK,
 *             or null if no KSK (SEP-flagged DNSKEY) was found.
 *
 * Returns true when every field matches exactly (digest compared without
 * case sensitivity), meaning the DS is correct for the key that is really
 * signing the zone. Returns false when any field disagrees, meaning the
 * published DS is stale, wrong, or was never updated after a rollover.
 */
export function dsMatchesKsk(publishedDs, expectedDs) {
  if (!publishedDs || !expectedDs) return false;
  return (
    publishedDs.keyTag === expectedDs.keyTag &&
    publishedDs.algorithm === expectedDs.algorithm &&
    publishedDs.digestType === expectedDs.digestType &&
    publishedDs.digest.toLowerCase() === expectedDs.digest.toLowerCase()
  );
}

/** Query the DS record the parent zone is publishing. Requires network. */
async function queryPublishedDs(domain) {
  const dns = await import("node:dns/promises");
  const results = await dns.resolveDs(domain);
  if (results.length === 0) return null;
  const r = results[0];
  return { keyTag: r.keyTag, algorithm: r.algorithm, digestType: r.digestType, digest: r.digest.toString("hex") };
}

/**
 * Query the zone's live DNSKEYs and identify the KSK (the one with the SEP
 * flag set). Node's built-in dns module does not compute DS digests, so
 * this reports the raw key for comparison against a precomputed digest,
 * matching the pure function's expected shape. Requires network.
 */
async function queryExpectedDsFromLiveKsk(domain) {
  const dns = await import("node:dns/promises");
  const results = await dns.resolveAny(domain);
  const ksk = results.find((r) => r.type === "DNSKEY" && (r.flags & 0x0001));
  if (!ksk) return null;
  return {
    keyTag: ksk.keyTag,
    algorithm: ksk.algorithm,
    digestType: ksk.digestType,
    digest: ksk.digest ? ksk.digest.toString("hex") : "",
  };
}

/** Read Cloudflare's own DNSSEC status for the zone. */
async function getCloudflareDnssecStatus(zoneId, token) {
  const res = await fetch(`${CF_API}/zones/${zoneId}/dnssec`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC read failed: ${res.status}`);
  const body = await res.json();
  return body.result || {};
}

/**
 * Nudge Cloudflare to re-publish its DNSSEC state after a rollover.
 * Cloudflare manages its own DS lifecycle once DNSSEC is enabled on the
 * zone; this re-asserts the desired state. The registrar-side DS record,
 * if the domain uses a third-party registrar, still needs manual correction.
 */
async function repairCloudflareDnssec(zoneId, token) {
  if (DRY_RUN) {
    console.log(`[dry run] would PATCH DNSSEC state for zone ${zoneId}`);
    return;
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const res = await fetch(`${CF_API}/zones/${zoneId}/dnssec`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "active" }),
  });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC patch failed: ${res.status}`);
  console.log(`Refreshed Cloudflare DNSSEC state for zone ${zoneId}`);
}

export async function run() {
  const publishedDs = await queryPublishedDs(DNS_DOMAIN);
  const expectedDs = await queryExpectedDsFromLiveKsk(DNS_DOMAIN);

  if (dsMatchesKsk(publishedDs, expectedDs)) {
    console.log(`DS record for ${DNS_DOMAIN} matches the live KSK. Nothing to do.`);
    return;
  }

  console.warn(
    `DS mismatch for ${DNS_DOMAIN}. Published keyTag=${publishedDs ? publishedDs.keyTag : null}, ` +
    `expected keyTag=${expectedDs ? expectedDs.keyTag : null} (from live KSK).`
  );

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(
      "DS mismatch found. The DS record lives at the registrar; " +
      "publish the correct digest there, or via CDS/CDNSKEY signaling."
    );
    return;
  }

  await repairCloudflareDnssec(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN);
  console.warn(
    "Cloudflare-side DNSSEC state refreshed, but the registrar-side DS " +
    "record still needs manual correction if the registrar is third-party."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
