/**
 * Detect a GitHub Pages custom domain DNS check failure and repair it via Cloudflare.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export const GITHUB_PAGES_A_RECORDS = new Set([
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
]);

export function diagnosePagesDns(apexARecords, wwwCnameTarget, requiredARecords, expectedCnameSuffix) {
  // Pure decision function. No network, no I/O.
  const missing = new Set([...requiredARecords].filter((ip) => !apexARecords.has(ip)));
  const extra = new Set([...apexARecords].filter((ip) => !requiredARecords.has(ip)));
  const apexOk = missing.size === 0 && extra.size === 0;
  const suffix = expectedCnameSuffix.replace(/^\./, "");
  const wwwOk = Boolean(wwwCnameTarget) && wwwCnameTarget.replace(/\.$/, "").endsWith(suffix);
  return {
    apex_ok: apexOk,
    apex_missing: missing,
    apex_extra: extra,
    www_ok: wwwOk,
    www_target: wwwCnameTarget,
  };
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const domain = process.env.DNS_DOMAIN || "example.com";
  const githubHostname = process.env.GITHUB_PAGES_HOSTNAME || "yourusername.github.io";
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  let apexARecords = new Set();
  try {
    apexARecords = new Set(await resolvePromises.resolve4(domain));
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") throw err;
  }

  const wwwName = `www.${domain}`;
  let wwwCnameTarget = null;
  try {
    const cnames = await resolvePromises.resolveCname(wwwName);
    wwwCnameTarget = cnames[0] || null;
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") throw err;
  }

  const report = diagnosePagesDns(apexARecords, wwwCnameTarget, GITHUB_PAGES_A_RECORDS, ".github.io");
  console.log(`Apex ok=${report.apex_ok} missing=${[...report.apex_missing]} extra=${[...report.apex_extra]}`);
  console.log(`www ok=${report.www_ok} target=${report.www_target}`);

  if (report.apex_ok && report.www_ok) {
    console.log("Nothing to repair. DNS matches GitHub Pages requirements.");
    return;
  }

  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;

  if (!report.apex_ok) {
    console.log(`Apex ${domain} is wrong. ${dryRun ? "Would" : "Will"} replace the A records with the four GitHub Pages IPs.`);
    if (!dryRun) {
      const existing = await (await fetch(`${base}?type=A&name=${domain}`, { headers })).json();
      for (const record of existing.result || []) {
        await fetch(`${base}/${record.id}`, { method: "DELETE", headers });
      }
      for (const ip of [...GITHUB_PAGES_A_RECORDS].sort()) {
        await fetch(base, { method: "POST", headers, body: JSON.stringify({ type: "A", name: domain, content: ip, ttl: 300 }) });
      }
    }
  }

  if (!report.www_ok) {
    console.log(`www.${domain} is wrong. ${dryRun ? "Would" : "Will"} replace it with a CNAME to ${githubHostname}.`);
    if (!dryRun) {
      const existing = await (await fetch(`${base}?name=${wwwName}`, { headers })).json();
      for (const record of existing.result || []) {
        await fetch(`${base}/${record.id}`, { method: "DELETE", headers });
      }
      await fetch(base, { method: "POST", headers, body: JSON.stringify({ type: "CNAME", name: wwwName, content: githubHostname, ttl: 300 }) });
    }
  }

  console.log("Done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
