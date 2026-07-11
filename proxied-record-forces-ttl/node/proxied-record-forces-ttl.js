/**
 * Detect a proxied Cloudflare record whose intended config expects a
 * custom TTL, which Cloudflare will always silently coerce to 1
 * (Automatic), and optionally repair the zone by either accepting
 * ttl: 1 in policy, or unproxying the record to keep a custom TTL.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 *   REPAIR_POLICY            "accept_automatic" or "unproxy", default "accept_automatic"
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const REPAIR_POLICY = process.env.REPAIR_POLICY || "accept_automatic";

const CF_API = "https://api.cloudflare.com/client/v4";

export function diagnoseTtlProxyMismatch(intended, live) {
  // Pure decision function. No I/O.
  //
  // intended, live: { ttl: number, proxied: boolean }
  //
  // Returns a mismatch reason string, or null if consistent.
  //   - If live.proxied is true and live.ttl !== 1: impossible/stale-cache state.
  //   - If intended.proxied is true and intended.ttl not in (1, null/undefined):
  //     config is invalid per Cloudflare rules (would be silently coerced to 1).
  //   - If intended.proxied !== live.proxied: proxy status itself drifted.
  //   - If intended.proxied is false and intended.ttl !== live.ttl:
  //     real TTL drift, not the proxied-TTL quirk.
  if (live.proxied === true && live.ttl !== 1) {
    return "impossible state: live record is proxied but ttl is not 1 (stale read or cache)";
  }

  const intendedTtl = intended.ttl;
  if (intended.proxied === true && intendedTtl !== 1 && intendedTtl != null) {
    return "invalid config: proxied records are always coerced to ttl 1 by Cloudflare";
  }

  if (intended.proxied !== live.proxied) {
    return "proxy status drifted between intended config and live zone";
  }

  if (intended.proxied === false && intendedTtl !== live.ttl) {
    return "real ttl drift on an unproxied record, not the proxied-ttl quirk";
  }

  return null;
}

async function fetchLiveRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ name: domain, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result;
}

async function repairRecord(recordId, domain, recordType, content, policy, desiredTtl = 300) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  let payload;
  if (policy === "accept_automatic") {
    payload = { type: recordType, name: domain, content, proxied: true, ttl: 1 };
  } else if (policy === "unproxy") {
    payload = { type: recordType, name: domain, content, proxied: false, ttl: desiredTtl };
  } else {
    throw new Error(`unknown policy: ${policy}`);
  }

  if (DRY_RUN) {
    console.log(`[dry run] would PATCH record ${recordId} with`, payload);
    return;
  }

  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Cloudflare patch returned ${res.status}`);
  console.log(`Repaired record ${recordId} with policy ${policy}`);
}

export async function run(intendedByName, policy = REPAIR_POLICY) {
  // intendedByName: object mapping record name -> { ttl, proxied }
  if (!intendedByName) {
    intendedByName = { [`app.${DNS_DOMAIN}`]: { ttl: 300, proxied: true } };
  }

  const liveRecords = await fetchLiveRecords(DNS_DOMAIN);
  let mismatches = 0;

  for (const rec of liveRecords) {
    const intended = intendedByName[rec.name];
    if (!intended) continue;

    const live = { ttl: rec.ttl, proxied: rec.proxied };
    const reason = diagnoseTtlProxyMismatch(intended, live);
    if (!reason) {
      console.log(`${rec.name}: consistent (ttl=${live.ttl}, proxied=${live.proxied})`);
      continue;
    }

    mismatches++;
    console.warn(`${rec.name}: ${reason}`);

    if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
      console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
      continue;
    }

    await repairRecord(
      rec.id, rec.name, rec.type, rec.content,
      policy, intended.ttl || 300,
    );
  }

  console.log(`Done. ${mismatches} mismatch(es) found.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
