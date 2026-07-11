/**
 * Detect a TTL that is too low for a record's real traffic and, on
 * repair, raise it back to a safe value through the Cloudflare API.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

const TTL_LADDER = [60, 120, 300, 900, 3600, 86400];

export function assessTtlRisk(ttlSeconds, dailyUniqueResolvers, qpsRiskThreshold = 5.0, minSafeTtl = 300) {
  // Pure decision function. No DNS I/O, no network calls.
  //
  // ttlSeconds: the record's current TTL, in seconds, as read from a
  //   live answer (node:dns) or the provider API.
  // dailyUniqueResolvers: a known or estimated count of unique
  //   resolvers/clients hitting the domain per day.
  // qpsRiskThreshold: flag the record once estimated authoritative
  //   queries per second crosses this value.
  // minSafeTtl: flag the record if its TTL is below this floor,
  //   regardless of estimated QPS.
  //
  // Returns { risky, estimatedQps, recommendedTtl }.
  const safeTtl = Math.max(ttlSeconds, 1);
  const estimatedQps = dailyUniqueResolvers / safeTtl;

  const risky = estimatedQps > qpsRiskThreshold || ttlSeconds < minSafeTtl;

  let recommendedTtl = TTL_LADDER[TTL_LADDER.length - 1];
  for (const candidate of TTL_LADDER) {
    if (dailyUniqueResolvers / candidate <= qpsRiskThreshold && candidate >= minSafeTtl) {
      recommendedTtl = candidate;
      break;
    }
  }

  return { risky, estimatedQps, recommendedTtl };
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const domain = process.env.DNS_DOMAIN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const dailyUniqueResolvers = Number(process.env.DAILY_UNIQUE_RESOLVERS || 50000);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

  const records = await resolvePromises.resolve4(domain, { ttl: true });
  const currentTtl = records[0].ttl;
  console.log(`Live TTL for ${domain} A record: ${currentTtl} seconds`);

  const result = assessTtlRisk(currentTtl, dailyUniqueResolvers);
  console.log(
    `Estimated QPS: ${result.estimatedQps.toFixed(4)}, risky: ${result.risky}, recommended TTL: ${result.recommendedTtl}`
  );

  if (!result.risky) {
    console.log("No fix needed. TTL is within a safe range for this traffic level.");
    return;
  }

  if (dryRun) {
    console.log(`Dry run: would raise TTL for ${domain} from ${currentTtl} to ${result.recommendedTtl} seconds`);
    return;
  }

  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(domain)}`,
    { headers }
  );
  if (!listRes.ok) throw new Error(`Cloudflare API list returned ${listRes.status}`);
  const listBody = await listRes.json();
  const record = (listBody.result || [])[0];
  if (!record) {
    console.warn(`No existing A record id found to update at ${domain}`);
    return;
  }

  const patchRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ttl: result.recommendedTtl }),
    }
  );
  if (!patchRes.ok) throw new Error(`Cloudflare API patch returned ${patchRes.status}`);
  console.log(`Raised TTL for ${domain} to ${result.recommendedTtl} seconds`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
