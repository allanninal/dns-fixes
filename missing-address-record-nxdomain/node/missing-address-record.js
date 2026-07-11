/**
 * Detect a missing A/AAAA record (true NXDOMAIN) and repair it via Cloudflare.
 *
 * NXDOMAIN with an empty answer means the hostname has no record at all in
 * the zone, not an A record, not an AAAA record, not even a CNAME. That is
 * different from NOERROR with an empty answer (NODATA), which means the name
 * exists but not for the record type queried. See RFC 8020.
 *
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 *
 * Environment:
 *   DNS_DOMAIN             the hostname to check, e.g. app.example.com
 *   RECORD_TYPE            "A" or "AAAA" (default "A")
 *   RECORD_TARGET          the IP address to point the record at
 *   RECORD_TTL             TTL in seconds (default 300)
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token (only needed for the repair)
 *   CLOUDFLARE_ZONE_ID     Cloudflare zone id (only needed for the repair)
 *   DRY_RUN                "true" (default) reports only, "false" writes
 */
import { pathToFileURL } from "node:url";

export function classifyMissingRecord(rcode, answerCount, expectedNameExists) {
  // Pure decision function. No network, no I/O.
  //
  // rcode: the DNS response rcode string, e.g. "NXDOMAIN" or "NOERROR".
  // answerCount: number of records in the answer section.
  // expectedNameExists: whether this name is expected to be provisioned.
  //
  // Returns one of "missing_record_nxdomain", "nodata_wrong_type", "ok",
  // or "unexpected".
  if (rcode === "NXDOMAIN" && answerCount === 0 && expectedNameExists) {
    return "missing_record_nxdomain";
  }
  if (rcode === "NOERROR" && answerCount === 0) {
    return "nodata_wrong_type";
  }
  if (answerCount > 0) {
    return "ok";
  }
  return "unexpected";
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");

  const domain = process.env.DNS_DOMAIN;
  const recordType = process.env.RECORD_TYPE || "A";
  const target = process.env.RECORD_TARGET || "203.0.113.10";
  const ttl = Number(process.env.RECORD_TTL || 300);
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  // Find the authoritative nameservers for the zone, then query them
  // directly so the answer cannot be a stale cache.
  const nameservers = await dns.promises.resolveNs(domain);
  const nsIp = (await dns.promises.resolve4(nameservers[0]))[0];

  const resolver = new dns.promises.Resolver();
  resolver.setServers([nsIp]);

  let rcode = "NOERROR";
  let answerCount = 0;
  try {
    const answers = recordType === "AAAA"
      ? await resolver.resolve6(domain)
      : await resolver.resolve4(domain);
    answerCount = answers.length;
  } catch (err) {
    if (err.code === "ENOTFOUND") {
      rcode = "NXDOMAIN";
    } else if (err.code === "ENODATA") {
      rcode = "NOERROR";
      answerCount = 0;
    } else {
      throw err;
    }
  }

  const outcome = classifyMissingRecord(rcode, answerCount, true);
  console.log(`Name ${domain} classified as ${outcome} (rcode=${rcode}, answers=${answerCount})`);

  if (outcome !== "missing_record_nxdomain") {
    console.log("Nothing to repair.");
    return;
  }

  console.log(`Missing ${recordType} record for ${domain}. ${dryRun ? "Would" : "Will"} create it pointing to ${target}.`);

  if (dryRun) return;

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: recordType, name: domain, content: target, ttl }),
  });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`Created ${recordType} record for ${domain} -> ${target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
