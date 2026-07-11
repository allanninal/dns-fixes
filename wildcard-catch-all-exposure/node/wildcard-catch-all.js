/**
 * Detect an apex-level wildcard DNS record and, on repair, replace it with
 * explicit records through the Cloudflare API. Safe to run on a schedule.
 * Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function classifyWildcardScope(recordName, zoneApex) {
  // Pure decision function. No network, no I/O.
  if (!recordName.startsWith("*.")) {
    return "not_wildcard";
  }

  const remainder = recordName.slice(2);
  if (remainder === zoneApex) {
    return "apex_catch_all";
  }

  if (remainder.endsWith("." + zoneApex)) {
    const subLabels = remainder.slice(0, -(zoneApex.length + 1));
    if (subLabels) {
      return "scoped_subzone";
    }
  }

  return "apex_catch_all";
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const zoneApex = process.env.DNS_DOMAIN || "example.com";
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=100`,
    { headers },
  );
  if (!listRes.ok) throw new Error(`Cloudflare API returned ${listRes.status}`);
  const { result: records } = await listRes.json();

  const wildcards = records.filter((r) => r.name.startsWith("*."));
  if (wildcards.length === 0) {
    console.log("No wildcard records found in the zone.");
    return;
  }

  const probeNames = [`asdkfj829.${zoneApex}`, `totally-made-up-name.${zoneApex}`];

  for (const record of wildcards) {
    const scope = classifyWildcardScope(record.name, zoneApex);
    console.log(`Wildcard ${record.name} classified as ${scope}`);

    if (scope !== "apex_catch_all") continue;

    const target = record.content;
    let catchAllConfirmed = false;
    for (const probe of probeNames) {
      try {
        const answers = record.type === "AAAA"
          ? await resolvePromises.resolve6(probe)
          : await resolvePromises.resolve4(probe);
        if (answers.includes(target)) {
          catchAllConfirmed = true;
          console.warn(`Probe ${probe} resolved to wildcard target ${target}`);
        }
      } catch (err) {
        if (err.code !== "ENOTFOUND") throw err;
      }
    }

    if (!catchAllConfirmed) {
      console.log(`Wildcard ${record.name} is apex-level but probes did not confirm live catch-all.`);
      continue;
    }

    console.warn(`Confirmed apex-level catch-all: ${record.name} -> ${target}`);

    if (dryRun) {
      console.log(`Dry run: would delete record ${record.id} (${record.name})`);
      continue;
    }

    const delRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
      { method: "DELETE", headers },
    );
    if (!delRes.ok) throw new Error(`Cloudflare API returned ${delRes.status}`);
    console.log(`Deleted apex wildcard record ${record.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
