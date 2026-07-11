/**
 * Detect a stale negative-cache NXDOMAIN across public resolvers.
 * Safe to run on a schedule. Only reads, unless you also lower the zone's
 * negative-cache TTL, which is guarded by DRY_RUN.
 */
import { pathToFileURL } from "node:url";

export function staleNegativeCacheReport(soaMinimum, soaTtlSeen, resolverResults, authoritativeHasRecord) {
  // Pure decision logic, no I/O.
  // resolverResults: { [resolverIp]: [rcode, sampleTtl] }
  const stale = [];
  const eta = {};
  for (const [resolver, [rcode, ttl]] of Object.entries(resolverResults)) {
    if (authoritativeHasRecord && rcode === "NXDOMAIN") {
      stale.push(resolver);
      eta[resolver] = Math.max(ttl, 0); // seconds remaining until this resolver's entry expires
    }
  }
  const etaValues = Object.values(eta);
  return {
    staleResolvers: stale,
    etaSeconds: eta,
    isStaleNegativeCache: authoritativeHasRecord && stale.length > 0,
    maxWaitSeconds: etaValues.length ? Math.max(...etaValues) : 0,
  };
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const domain = process.env.DNS_DOMAIN;
  const zone = process.env.DNS_ZONE || domain;
  const publicResolvers = (process.env.PUBLIC_RESOLVERS || "1.1.1.1,8.8.8.8,9.9.9.9").split(",");
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  // Confirm the record at the authoritative server first, bypassing recursion.
  const nameservers = await resolvePromises.resolveNs(zone);
  const nsIp = (await resolvePromises.resolve4(nameservers[0]))[0];

  const authResolver = new dns.promises.Resolver();
  authResolver.setServers([nsIp]);

  let authoritativeHasRecord = true;
  try {
    await authResolver.resolve4(domain);
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      authoritativeHasRecord = false;
    } else {
      throw err;
    }
  }

  // Read the zone's SOA MINIMUM (negative-cache TTL). Node's resolveSoa
  // exposes it as minttl.
  const soa = await resolvePromises.resolveSoa(zone);
  const soaMinimum = soa.minttl;

  // Query each public resolver directly and record rcode plus a sample TTL.
  const resolverResults = {};
  for (const ip of publicResolvers) {
    const r = new dns.promises.Resolver();
    r.setServers([ip.trim()]);
    try {
      await r.resolve4(domain);
      resolverResults[ip.trim()] = ["NOERROR", 0];
    } catch (err) {
      if (err.code === "ENOTFOUND") {
        // node:dns does not expose the authority-section SOA TTL directly,
        // so a real implementation would parse the raw response; here we
        // record the negative hit with an unknown (0) sample TTL.
        resolverResults[ip.trim()] = ["NXDOMAIN", 0];
      } else if (err.code === "ENODATA") {
        resolverResults[ip.trim()] = ["NOERROR", 0];
      } else {
        throw err;
      }
    }
  }

  const report = staleNegativeCacheReport(soaMinimum, 0, resolverResults, authoritativeHasRecord);
  console.log(`Report for ${domain}:`, report);

  if (!report.isStaleNegativeCache) {
    console.log("No stale negative cache detected.");
    return;
  }

  console.log(`Stale on ${report.staleResolvers.join(", ")}. Longest wait about ${report.maxWaitSeconds} seconds.`);

  if (!zoneId || !apiToken) {
    console.log("No Cloudflare credentials set, skipping negative-cache TTL check.");
    return;
  }

  const settingsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_settings`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!settingsRes.ok) throw new Error(`Cloudflare API returned ${settingsRes.status}`);
  const settings = await settingsRes.json();
  console.log("Current zone DNS settings:", settings.result);

  if (dryRun) {
    console.log("Dry run: would lower the zone's negative-cache TTL to speed up future recovery.");
    return;
  }

  const patchRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ns_ttl: 300 }),
  });
  if (!patchRes.ok) throw new Error(`Cloudflare API returned ${patchRes.status}`);
  console.log("Lowered the zone's negative-cache TTL to 300 seconds for next time.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
