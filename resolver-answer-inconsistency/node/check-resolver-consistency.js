/**
 * Detect whether public resolvers disagree with a zone's authoritative
 * answer because of ordinary TTL caching, or because of a real mismatch
 * at the DNS host. On repair, lowers the record's TTL through the
 * Cloudflare API so future changes converge faster. Safe to run again
 * and again.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const RECORD_TYPE = process.env.RECORD_TYPE || "A";
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222"];
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function diagnoseResolverInconsistency(authoritativeAnswer, resolverAnswers, resolverTtls, configuredTtl) {
  // Pure decision logic, no I/O.
  //
  // authoritativeAnswer: Set of record values from the zone's own
  // authoritative NS (source of truth).
  // resolverAnswers: Map(resolverIp -> Set of record values returned).
  // resolverTtls: Map(resolverIp -> TTL currently reported for that answer).
  // configuredTtl: the TTL currently set on the authoritative record.
  //
  // Returns { consistent, staleResolvers, likelyCause, recommendLowerTtl }.
  //
  // A resolver is "stale" if its answer set differs from authoritativeAnswer.
  // If authoritativeAnswer itself is not unanimous across resolvers that DO
  // match it, and configuredTtl is high (over 3600 seconds), the cause is
  // "propagation_lag" and recommendLowerTtl is true. If even resolvers with
  // expired-looking TTLs (close to 0) still disagree with authoritativeAnswer,
  // or all stale resolvers agree with each other but none match the
  // authoritative answer, the cause is "authoritative_mismatch" (a partial
  // rollout at the DNS host) and recommendLowerTtl is false.
  const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

  const staleResolvers = [];
  for (const [ip, answer] of resolverAnswers) {
    if (!sameSet(answer, authoritativeAnswer)) staleResolvers.push(ip);
  }

  if (staleResolvers.length === 0) {
    return { consistent: true, staleResolvers: [], likelyCause: "none", recommendLowerTtl: false };
  }

  const matching = [...resolverAnswers.keys()].filter((ip) => !staleResolvers.includes(ip));

  const nearExpiredButStillStale = staleResolvers.some((ip) => (resolverTtls.get(ip) ?? configuredTtl) <= 5);
  const staleAnswerKey = (ip) => JSON.stringify([...resolverAnswers.get(ip)].sort());
  const allStaleAgreeWithEachOther = new Set(staleResolvers.map(staleAnswerKey)).size === 1;
  const noResolverMatchesAuthoritative = matching.length === 0;

  if (nearExpiredButStillStale || (allStaleAgreeWithEachOther && noResolverMatchesAuthoritative)) {
    return { consistent: false, staleResolvers, likelyCause: "authoritative_mismatch", recommendLowerTtl: false };
  }

  return {
    consistent: false,
    staleResolvers,
    likelyCause: "propagation_lag",
    recommendLowerTtl: configuredTtl > 3600,
  };
}

async function queryResolver(name, rdtype, resolverIp) {
  // One resolver's answer set and the TTL it currently reports.
  const dns = await import("node:dns");
  const { Resolver } = dns.promises;
  const resolver = new Resolver();
  resolver.setServers([resolverIp]);

  const method = rdtype === "AAAA" ? "resolve6" : "resolve4";
  const values = await resolver[method](name, { ttl: true });
  const set = new Set(values.map((v) => v.address));
  const ttl = values.length ? values[0].ttl : 0;
  return { values: set, ttl };
}

async function queryAuthoritative(name, rdtype, domain) {
  // Ask the zone's own authoritative nameservers directly, bypassing every
  // public resolver's cache.
  const dns = await import("node:dns");
  const { Resolver } = dns.promises;

  const defaultResolver = new Resolver();
  const nsHosts = await defaultResolver.resolveNs(domain);
  const nsIps = await defaultResolver.resolve4(nsHosts[0]);

  const authResolver = new Resolver();
  authResolver.setServers([nsIps[0]]);
  const method = rdtype === "AAAA" ? "resolve6" : "resolve4";
  const values = await authResolver[method](name, { ttl: true });
  const set = new Set(values.map((v) => v.address));
  const ttl = values.length ? values[0].ttl : 0;
  return { values: set, ttl };
}

async function findRecordId(name, rdtype) {
  const url = new URL(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`);
  url.searchParams.set("type", rdtype);
  url.searchParams.set("name", name);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  const { result } = await res.json();
  return result[0] || null;
}

async function lowerTtl(recordId, name, rdtype, content, newTtl = 300) {
  // Repair step: lower the record's TTL through the Cloudflare API so
  // future changes converge faster. Only called for propagation lag with
  // a high configured TTL, never for an authoritative mismatch.
  const url = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: rdtype, name, content, ttl: newTtl }),
  });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  return res.json();
}

export async function run() {
  console.log(`Checking resolver consistency for ${DNS_DOMAIN} ${RECORD_TYPE} (DRY_RUN=${DRY_RUN})`);

  const { values: authoritativeAnswer, ttl: configuredTtl } = await queryAuthoritative(DNS_DOMAIN, RECORD_TYPE, DNS_DOMAIN);
  console.log(`Authoritative answer: ${[...authoritativeAnswer].sort()} (TTL ${configuredTtl})`);

  const resolverAnswers = new Map();
  const resolverTtls = new Map();
  for (const ip of PUBLIC_RESOLVERS) {
    try {
      const { values, ttl } = await queryResolver(DNS_DOMAIN, RECORD_TYPE, ip);
      resolverAnswers.set(ip, values);
      resolverTtls.set(ip, ttl);
      console.log(`Resolver ${ip}: ${[...values].sort()} (TTL ${ttl})`);
    } catch (err) {
      console.warn(`Resolver ${ip} failed to answer: ${err.message}`);
    }
  }

  const result = diagnoseResolverInconsistency(authoritativeAnswer, resolverAnswers, resolverTtls, configuredTtl);
  console.log("Diagnosis:", result);

  if (result.consistent) {
    console.log("OK: every resolver agrees with the authoritative answer. Nothing to do.");
    return;
  }

  if (result.likelyCause === "authoritative_mismatch") {
    console.warn(
      "Authoritative mismatch detected, this is not ordinary propagation. " +
      "Fix the record at the DNS host so every authoritative server agrees."
    );
    return;
  }

  console.warn(
    `Ordinary propagation lag. Stale resolvers: ${result.staleResolvers}. This will clear on its own ` +
    `within the current TTL window (${configuredTtl} seconds).`
  );

  if (result.recommendLowerTtl) {
    const record = await findRecordId(DNS_DOMAIN, RECORD_TYPE);
    if (!record) {
      console.warn("Could not find the record via the Cloudflare API to lower its TTL.");
      return;
    }
    if (DRY_RUN) {
      console.log(`Dry run: would lower TTL for record ${record.id} from ${configuredTtl} to 300`);
      return;
    }
    await lowerTtl(record.id, DNS_DOMAIN, RECORD_TYPE, record.content, 300);
    console.log(`Lowered TTL for ${DNS_DOMAIN} to 300 seconds so future changes converge faster.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
