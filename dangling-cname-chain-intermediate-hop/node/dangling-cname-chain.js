/**
 * Walk a CNAME chain hop by hop, find the dangling intermediate hop, and
 * repair the record you control via Cloudflare. Safe to run on a schedule.
 * Stays in dry run until DRY_RUN=false.
 *
 * Env vars:
 *   DNS_DOMAIN            the top-level hostname to walk, e.g. app.example.com
 *   MAX_DEPTH             max hops to follow before giving up (default 10)
 *   DRY_RUN               "true" (default) or "false"
 *   CLOUDFLARE_API_TOKEN  Cloudflare API token with DNS edit permission
 *   CLOUDFLARE_ZONE_ID    the zone id that owns the record to repair
 *   REPLACEMENT_TARGET    if set, PATCH the owned record to this target;
 *                         if unset, DELETE the owned record instead
 */
import { pathToFileURL } from "node:url";

export function findDanglingHop(chain, maxDepth = 10) {
  // Pure decision logic, no I/O. The DNS resolution itself happens in run().
  //
  // Each item in chain is an object:
  //   { hostname, isCname, target, resolvedStatus: "OK" | "NXDOMAIN" | "SERVFAIL" }
  //
  // Returns the first item in the chain (scanning every hop, not just the
  // first) whose resolvedStatus is NXDOMAIN or SERVFAIL, or null if the
  // whole chain resolves cleanly to a terminal A/AAAA record within
  // maxDepth hops. Returns a chain-too-long marker if the chain exceeds
  // maxDepth without terminating (possible loop).
  if (chain.length > maxDepth) {
    return { hostname: chain[maxDepth].hostname, reason: "chain-too-long" };
  }
  for (const hop of chain) {
    if (hop.resolvedStatus === "NXDOMAIN" || hop.resolvedStatus === "SERVFAIL") {
      return hop;
    }
  }
  return null;
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolver = dns.promises;

  const domain = process.env.DNS_DOMAIN;
  const maxDepth = Number(process.env.MAX_DEPTH || 10);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const chain = [];
  let current = domain;

  for (let i = 0; i <= maxDepth; i++) {
    try {
      const answers = await resolver.resolveCname(current);
      const target = answers[0];
      chain.push({ hostname: current, isCname: true, target, resolvedStatus: "OK" });
      current = target;
      continue;
    } catch (err) {
      if (err.code === "ENOTFOUND") {
        chain.push({ hostname: current, isCname: false, target: null, resolvedStatus: "NXDOMAIN" });
        break;
      }
      if (err.code === "ENODATA") {
        try {
          await resolver.resolve4(current);
          chain.push({ hostname: current, isCname: false, target: null, resolvedStatus: "OK" });
        } catch {
          chain.push({ hostname: current, isCname: false, target: null, resolvedStatus: "SERVFAIL" });
        }
        break;
      }
      chain.push({ hostname: current, isCname: false, target: null, resolvedStatus: "SERVFAIL" });
      break;
    }
  }

  const dangling = findDanglingHop(chain, maxDepth);

  if (dangling === null) {
    console.log(`Chain for ${domain} resolves cleanly, ${chain.length} hop(s), no dangling hop found.`);
    return;
  }

  if (dangling.reason === "chain-too-long") {
    console.warn(`Chain for ${domain} exceeded max depth ${maxDepth}, possible loop.`);
    return;
  }

  console.warn(`Dangling hop found: ${dangling.hostname} (status=${dangling.resolvedStatus})`);

  const brokenIndex = chain.indexOf(dangling);
  if (brokenIndex === 0) {
    console.warn("The dangling hop is the top-level name itself. Nothing upstream to repoint.");
    return;
  }

  const ownedRecordName = chain[brokenIndex - 1].hostname;
  console.warn(`Record to repair: ${ownedRecordName} (currently points at ${dangling.hostname})`);

  if (!zoneId || !apiToken) {
    console.log(`No Cloudflare credentials set, skipping repair. ${ownedRecordName} would be repointed or deleted.`);
    return;
  }

  const replacementTarget = process.env.REPLACEMENT_TARGET;
  console.log(`${dryRun ? "Would repoint" : "Repointing"} record ${ownedRecordName} to ${replacementTarget || "(delete, no replacement target set)"}.`);

  if (dryRun) return;

  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;

  const lookupRes = await fetch(`${base}?name=${encodeURIComponent(ownedRecordName)}`, { headers });
  if (!lookupRes.ok) throw new Error(`Cloudflare API returned ${lookupRes.status}`);
  const lookupBody = await lookupRes.json();
  const records = lookupBody.result || [];
  if (records.length === 0) {
    console.warn(`Could not find a Cloudflare DNS record named ${ownedRecordName} to repair.`);
    return;
  }
  const recordId = records[0].id;

  const patchRes = replacementTarget
    ? await fetch(`${base}/${recordId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content: replacementTarget }),
      })
    : await fetch(`${base}/${recordId}`, { method: "DELETE", headers });

  if (!patchRes.ok) throw new Error(`Cloudflare API returned ${patchRes.status}`);
  console.log(`Repaired ${ownedRecordName}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
