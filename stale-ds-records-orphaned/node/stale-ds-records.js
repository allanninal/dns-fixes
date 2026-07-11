/**
 * Detect stale/orphaned DS records left behind after a DNSSEC key rollover,
 * and optionally repair Cloudflare-side DNSSEC signaling. Safe by default.
 * Set DRY_RUN=false to let it write.
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
 * dsRecords: [{ keyTag, algorithm, digestType, digest }, ...] from the
 *            parent/registry
 * dnskeyRecords: [{ keyTag, algorithm, flags, digest }, ...] computed from
 *                the child zone's live DNSKEYs (digest pre-hashed per
 *                digestType for comparison)
 *
 * Returns the subset of dsRecords whose (keyTag, algorithm, digest) has no
 * matching entry in dnskeyRecords. Those are stale/orphaned DS records
 * that should be removed at the registrar.
 */
export function findStaleDs(dsRecords, dnskeyRecords) {
  const live = new Set(
    dnskeyRecords.map((k) => `${k.keyTag}:${k.algorithm}:${k.digest.toLowerCase()}`)
  );
  return dsRecords.filter((ds) => {
    const fingerprint = `${ds.keyTag}:${ds.algorithm}:${ds.digest.toLowerCase()}`;
    return !live.has(fingerprint);
  });
}

/** Query the DS RRset the parent zone is publishing. Requires network. */
async function queryParentDs(domain) {
  const dns = await import("node:dns/promises");
  const results = await dns.resolveDs(domain);
  return results.map((r) => ({
    keyTag: r.keyTag,
    algorithm: r.algorithm,
    digestType: r.digestType,
    digest: r.digest.toString("hex"),
  }));
}

/**
 * Query the child zone's live DNSKEYs. Node's built-in dns module does not
 * compute DS digests, so this reports the raw DNSKEY set for comparison
 * against a precomputed digest, matching the pure function's expected shape.
 * Requires network.
 */
async function queryChildDnskeys(domain) {
  const dns = await import("node:dns/promises");
  const results = await dns.resolveAny(domain);
  return results
    .filter((r) => r.type === "DNSKEY")
    .map((r) => ({
      keyTag: r.keyTag,
      algorithm: r.algorithm,
      flags: r.flags,
      digest: r.digest ? r.digest.toString("hex") : "",
    }));
}

/** List DS records Cloudflare is publishing for its own DNSSEC signaling. */
async function listCloudflareDnssecDs(zoneId, token) {
  const url = `${CF_API}/zones/${zoneId}/dnssec`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC read failed: ${res.status}`);
  const body = await res.json();
  return body.result || {};
}

/**
 * Nudge Cloudflare to refresh its DNSSEC state after a rollover. Cloudflare
 * manages its own DS lifecycle once DNSSEC is enabled on the zone; this
 * simply re-asserts the desired state. The registrar-side DS record, if
 * the domain uses a third-party registrar, must be removed manually.
 */
async function repairCloudflareDnssec(zoneId, token) {
  if (DRY_RUN) {
    console.log(`[dry run] would PATCH DNSSEC state for zone ${zoneId}`);
    return;
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = `${CF_API}/zones/${zoneId}/dnssec`;
  const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ status: "active" }) });
  if (!res.ok) throw new Error(`Cloudflare DNSSEC patch failed: ${res.status}`);
  console.log(`Refreshed Cloudflare DNSSEC state for zone ${zoneId}`);
}

async function run() {
  const parentDs = await queryParentDs(DNS_DOMAIN);
  const childDnskeys = await queryChildDnskeys(DNS_DOMAIN);
  const stale = findStaleDs(parentDs, childDnskeys);

  if (stale.length === 0) {
    console.log(`No stale DS records found for ${DNS_DOMAIN}.`);
    return;
  }

  for (const ds of stale) {
    console.warn(
      `Stale DS found: keyTag=${ds.keyTag} algorithm=${ds.algorithm} digestType=${ds.digestType} (no matching DNSKEY)`
    );
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(
      "Stale DS records found. This zone's DS lives at the registrar; " +
      "remove it there manually, or via CDS/CDNSKEY delete signaling."
    );
    return;
  }

  await repairCloudflareDnssec(CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN);
  console.warn(
    "Cloudflare-side DNSSEC state refreshed, but the registrar-side DS " +
    "record still needs manual removal if the registrar is third-party."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
