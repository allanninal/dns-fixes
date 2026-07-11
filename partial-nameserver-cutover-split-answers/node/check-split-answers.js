/**
 * Find a partial nameserver cutover: query every authoritative nameserver
 * for a domain directly and flag any one whose records disagree with the rest.
 * Optionally push missing records to the new provider through the Cloudflare API.
 *
 * Env vars:
 *   DNS_DOMAIN              domain to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN    only needed for the repair path
 *   CLOUDFLARE_ZONE_ID      only needed for the repair path
 *   DRY_RUN                 defaults to "true"; set to "false" to let it write
 *
 * Safe to run again and again. Read-only unless DRY_RUN is turned off.
 */
import { pathToFileURL } from "node:url";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT"];

/**
 * nsRecords: mapping of nameserver hostname -> {recordType: sorted array of rdata strings}
 *   e.g. {"ns1.oldhost.com": {A: ["203.0.113.5"], TXT: ["v=spf1 ... ~all"]},
 *         "lena.ns.cloudflare.com": {A: ["198.51.100.9"], TXT: ["v=spf1 ... ~all"]}}
 * Returns: mapping of recordType -> array of nameserver hostnames that disagree with the
 *          majority answer for that type (empty object if all nameservers agree).
 * Pure/I-O free: takes pre-fetched data in, returns a diff report out; no network calls inside.
 */
export function diffNameserverAnswers(nsRecords) {
  const disagreements = {};
  const hosts = Object.keys(nsRecords);
  if (hosts.length < 2) return disagreements;

  for (const rtype of RECORD_TYPES) {
    const answers = {};
    for (const host of hosts) {
      answers[host] = JSON.stringify((nsRecords[host][rtype] || []).slice().sort());
    }
    const counts = {};
    for (const value of Object.values(answers)) counts[value] = (counts[value] || 0) + 1;
    const distinctValues = Object.keys(counts);
    if (distinctValues.length <= 1) continue; // every nameserver agrees for this record type

    const majorityValue = distinctValues.reduce((a, b) => (counts[a] >= counts[b] ? a : b));
    const outliers = hosts.filter((host) => answers[host] !== majorityValue).sort();
    if (outliers.length) disagreements[rtype] = outliers;
  }
  return disagreements;
}

async function run() {
  const dns = await import("node:dns");

  const domain = process.env.DNS_DOMAIN;
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;

  console.log(`Resolving nameservers for ${domain}`);
  const nsHosts = (await dns.promises.resolveNs(domain)).sort();
  console.log(`Found ${nsHosts.length} nameserver(s): ${nsHosts.join(", ")}`);

  const nsRecords = {};
  for (const host of nsHosts) {
    let nsIp;
    try {
      nsIp = (await dns.promises.resolve4(host))[0];
    } catch (err) {
      console.warn(`Could not resolve nameserver ${host}: ${err.message}`);
      continue;
    }
    const resolver = new dns.promises.Resolver();
    resolver.setServers([nsIp]);
    const records = {};
    for (const rtype of RECORD_TYPES) {
      try {
        if (rtype === "MX") {
          const mx = await resolver.resolveMx(domain);
          records[rtype] = mx.map((m) => `${m.priority} ${m.exchange}`).sort();
        } else if (rtype === "TXT") {
          const txt = await resolver.resolveTxt(domain);
          records[rtype] = txt.map((t) => t.join("")).sort();
        } else if (rtype === "CNAME") {
          records[rtype] = (await resolver.resolveCname(domain)).sort();
        } else if (rtype === "AAAA") {
          records[rtype] = (await resolver.resolve6(domain)).sort();
        } else {
          records[rtype] = (await resolver.resolve4(domain)).sort();
        }
      } catch {
        records[rtype] = [];
      }
    }
    nsRecords[host] = records;
  }

  const disagreements = diffNameserverAnswers(nsRecords);
  if (Object.keys(disagreements).length === 0) {
    console.log("All nameservers agree. No split detected.");
    return;
  }

  for (const [rtype, outliers] of Object.entries(disagreements)) {
    console.warn(`Record type ${rtype} disagrees on: ${outliers.join(", ")}`);
  }

  if (dryRun || !(cfToken && cfZoneId)) {
    console.log("Dry run (or missing Cloudflare credentials): not writing any records.");
    return;
  }

  // Best effort repair: copy the majority answer for each mismatched type
  // into the new provider's zone through the Cloudflare API.
  for (const rtype of Object.keys(disagreements)) {
    const majorityHost = nsHosts.find((h) => !disagreements[rtype].includes(h));
    const values = nsRecords[majorityHost][rtype] || [];
    for (const value of values) {
      console.log(`Would create/update ${rtype} record ${domain} -> ${value} at Cloudflare`);
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: rtype, name: domain, content: value, ttl: 300 }),
        }
      );
      if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
    }
  }
  console.log("Repair pushed. Remember: removing the old nameservers is a registrar action, not covered here.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
