/**
 * Detect a www/apex DNS mismatch and optionally repair it via Cloudflare.
 * Safe by default. Set DRY_RUN=false to let it write.
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
 * apexIps/wwwIps are Sets of resolved IPs (empty set = NXDOMAIN/no record).
 * apexCname/wwwCname are the CNAME target strings if present, else null.
 *
 * Returns one of: "ok", "apex_missing", "www_missing", "both_missing", "ip_mismatch"
 */
export function diagnoseWwwApex(apexIps, apexCname, wwwIps, wwwCname) {
  const apexOk = apexIps.size > 0 || Boolean(apexCname);
  const wwwOk = wwwIps.size > 0 || Boolean(wwwCname);

  if (!apexOk && !wwwOk) return "both_missing";
  if (!apexOk) return "apex_missing";
  if (!wwwOk) return "www_missing";

  if (apexIps.size > 0 && wwwIps.size > 0) {
    const disjoint = [...apexIps].every((ip) => !wwwIps.has(ip));
    if (disjoint) return "ip_mismatch";
  }
  return "ok";
}

/** Resolve A, AAAA, and CNAME for a name. Requires network. */
async function resolveName(name) {
  const dns = await import("node:dns/promises");
  const ips = new Set();
  let cname = null;

  for (const type of ["A", "AAAA"]) {
    try {
      const answer = await dns.resolve(name, type);
      answer.forEach((ip) => ips.add(ip));
    } catch {
      // no answer for this type, keep going
    }
  }
  try {
    const answer = await dns.resolveCname(name);
    if (answer.length) cname = answer[0].replace(/\.$/, "");
  } catch {
    // no CNAME present
  }
  return { ips, cname };
}

/** Find an existing record via the Cloudflare API, or null. */
async function findRecordId(name, type) {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${type}&name=${name}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  const result = body.result || [];
  return result.length ? result[0].id : null;
}

/** Create the missing record through the Cloudflare API. */
async function createRecord(type, name, content) {
  if (DRY_RUN) {
    console.log(`[dry run] would create ${type} record ${name} -> ${content}`);
    return;
  }

  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type, name, content, ttl: 300, proxied: false }),
  });
  if (!res.ok) throw new Error(`Cloudflare create failed: ${res.status}`);
  console.log(`Created ${type} record ${name} -> ${content}`);
}

export async function run() {
  const apex = DNS_DOMAIN;
  const www = `www.${DNS_DOMAIN}`;

  const { ips: apexIps, cname: apexCname } = await resolveName(apex);
  const { ips: wwwIps, cname: wwwCname } = await resolveName(www);

  const verdict = diagnoseWwwApex(apexIps, apexCname, wwwIps, wwwCname);
  console.log(`Diagnosis for ${apex} / ${www}: ${verdict}`);

  if (verdict === "ok") {
    console.log("Nothing to repair.");
    return;
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("Mismatch found but no Cloudflare credentials set. Skipping repair.");
    return;
  }

  if (verdict === "apex_missing" && wwwIps.size > 0) {
    const replacementIp = process.env.REPLACEMENT_IP || [...wwwIps][0];
    if (!(await findRecordId(apex, "A"))) {
      await createRecord("A", apex, replacementIp);
    }
  } else if (verdict === "www_missing" && (apexIps.size > 0 || apexCname)) {
    const target = apexCname || apex;
    if (!(await findRecordId(www, "CNAME"))) {
      await createRecord("CNAME", www, target);
    }
  } else {
    console.warn(`Verdict ${verdict} needs a manual decision on which side is correct.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
