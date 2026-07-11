/**
 * Detect (and, where safe, repair) a zone lookup failure for an ACME
 * DNS-01 challenge name. Replicates the label walk with Node's built-in
 * dns module to find the true DNS-side apex, then checks whether that
 * exact name is a zone registered in the Cloudflare account. If they
 * disagree, this reports the mismatch. If DRY_RUN is false and a usable
 * zone was found, it writes the _acme-challenge TXT record through the
 * Cloudflare API.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "sub.example.com";
const CHALLENGE_VALUE = process.env.CHALLENGE_VALUE || "placeholder-token";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function fqdnLabels(fqdn) {
  // Split a name into labels, most-specific first, e.g.
  // "sub.example.com" -> ["sub", "example", "com"]
  return fqdn.replace(/\.$/, "").split(".").filter(Boolean);
}

export function candidateSuffixes(labels) {
  // All suffixes of the label list, shortest-label-stripped-first, e.g.
  // ["_acme-challenge","sub","example","com"] ->
  // ["sub.example.com", "example.com", "com"]
  const suffixes = [];
  for (let i = 1; i < labels.length; i++) {
    suffixes.push(labels.slice(i).join("."));
  }
  return suffixes;
}

/**
 * fqdnLabels: labels of the challenge name from most-specific to root,
 *             e.g. ["_acme-challenge","www","sub","example","com"]
 * soaPresentAt: maps a candidate zone apex string (e.g. "sub.example.com")
 *               to whether a live DNS query returned an authoritative SOA there
 * apiZoneNames: set of zone names the DNS provider account actually has registered
 * Returns the zone apex to write records into, or null if walk and API zone
 * list never agree (i.e. the failure this issue describes).
 * Pure decision logic: walk suffixes shortest-label-stripped-first, find first
 * suffix with soaPresentAt[suffix] true, then require that suffix to also be
 * in apiZoneNames; else return null.
 */
export function resolveZoneForChallenge(labels, soaPresentAt, apiZoneNames) {
  for (const suffix of candidateSuffixes(labels)) {
    if (soaPresentAt[suffix]) {
      return apiZoneNames.has(suffix) ? suffix : null;
    }
  }
  return null;
}

async function querySoaPresentAt(suffixes) {
  // Live DNS side: for each candidate suffix, ask for an SOA record and
  // record whether an authoritative answer came back.
  const dns = await import("node:dns");
  const resolveSoa = (name) =>
    new Promise((resolve) => {
      dns.resolveSoa(name, (err) => resolve(!err));
    });

  const present = {};
  for (const suffix of suffixes) {
    present[suffix] = await resolveSoa(suffix);
  }
  return present;
}

async function fetchCloudflareZoneNames(candidateNames) {
  // Provider side: ask Cloudflare's zone list for each candidate name and
  // collect which ones actually exist in this account.
  const found = new Set();
  for (const name of candidateNames) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`Cloudflare zone lookup failed: ${res.status}`);
    const data = await res.json();
    for (const zone of data.result || []) found.add(zone.name);
  }
  return found;
}

async function writeAcmeTxtRecord(zoneId, challengeFqdn, value) {
  // Guarded by DRY_RUN. Writes the _acme-challenge TXT record through the
  // Cloudflare DNS API once a usable zone has been confirmed.
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "TXT", name: challengeFqdn, content: value, ttl: 120 }),
  });
  if (!res.ok) throw new Error(`Cloudflare TXT write failed: ${res.status}`);
  return res.json();
}

export async function run() {
  const challengeFqdn = `_acme-challenge.${DNS_DOMAIN}`;
  const labels = fqdnLabels(challengeFqdn);
  const suffixes = candidateSuffixes(labels);

  console.log(`Walking labels for ${challengeFqdn}: candidates ${JSON.stringify(suffixes)}`);

  const soaPresentAt = await querySoaPresentAt(suffixes);
  const apiZoneNames = await fetchCloudflareZoneNames(suffixes);

  console.log("SOA present at:", Object.fromEntries(Object.entries(soaPresentAt).filter(([, v]) => v)));
  console.log("Provider account zone names found:", [...apiZoneNames].sort());

  const zone = resolveZoneForChallenge(labels, soaPresentAt, apiZoneNames);

  if (zone === null) {
    console.warn(
      `Could not determine the zone for ${challengeFqdn}. The SOA walk and the ` +
      "provider account's zone list never agreed on an apex. Check delegation " +
      "with dig NS, and confirm which name is actually registered with the " +
      "provider API."
    );
    return;
  }

  console.log(`Resolved zone: ${zone}`);

  if (DRY_RUN) {
    console.log(`DRY_RUN is true. Would write TXT record ${challengeFqdn} in zone ${zone}.`);
    return;
  }

  if (!CLOUDFLARE_ZONE_ID) {
    console.warn("DRY_RUN is false but CLOUDFLARE_ZONE_ID is not set. Not writing.");
    return;
  }

  await writeAcmeTxtRecord(CLOUDFLARE_ZONE_ID, challengeFqdn, CHALLENGE_VALUE);
  console.log(`Wrote TXT record ${challengeFqdn} in zone ${zone}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
