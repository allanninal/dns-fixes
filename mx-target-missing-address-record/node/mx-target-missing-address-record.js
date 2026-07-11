/**
 * Detect an MX target with no A/AAAA record (a dangling MX) and repair it
 * via Cloudflare. Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function findDanglingMxTargets(mxTargets, resolvedAddresses) {
  // mxTargets: array of MX target hostnames (e.g. ["mail.example.com"]).
  // resolvedAddresses: object mapping hostname -> array of A/AAAA IPs already
  // looked up (empty array if none/NXDOMAIN).
  // Returns the subset of mxTargets with no A or AAAA address (dangling MX),
  // preserving order, deduplicated.
  const seen = new Set();
  const dangling = [];
  for (const host of mxTargets) {
    if (seen.has(host)) continue;
    seen.add(host);
    const addresses = resolvedAddresses[host] || [];
    if (addresses.length === 0) dangling.push(host);
  }
  return dangling;
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const domain = process.env.DNS_DOMAIN;
  const fallbackIp = process.env.RECORD_TARGET || "203.0.113.25";
  const ttl = Number(process.env.RECORD_TTL || 3600);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const mxRecords = await resolvePromises.resolveMx(domain);
  const mxTargets = mxRecords.map((r) => r.exchange.replace(/\.$/, ""));
  console.log(`Found ${mxTargets.length} MX target(s) for ${domain}: ${mxTargets.join(", ")}`);

  const resolvedAddresses = {};
  for (const host of mxTargets) {
    const addresses = [];
    for (const resolveFn of [resolvePromises.resolve4, resolvePromises.resolve6]) {
      try {
        const answers = await resolveFn.call(resolvePromises, host);
        addresses.push(...answers);
      } catch (err) {
        if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") throw err;
      }
    }
    resolvedAddresses[host] = addresses;
  }

  const dangling = findDanglingMxTargets(mxTargets, resolvedAddresses);

  if (dangling.length === 0) {
    console.log(`Every MX target for ${domain} has an A or AAAA record. Nothing to repair.`);
    return;
  }

  for (const host of dangling) {
    console.log(`MX target ${host} has no A/AAAA record. ${dryRun ? "Would" : "Will"} create an A record pointing to ${fallbackIp}.`);

    if (dryRun) continue;

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "A", name: host, content: fallbackIp, ttl, proxied: false }),
    });
    if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
    console.log(`Created A record for ${host} -> ${fallbackIp} (DNS only)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
