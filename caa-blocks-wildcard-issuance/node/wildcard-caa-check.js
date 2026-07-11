/**
 * Detect an issuewild CAA record that blocks wildcard certificate issuance
 * and, on repair, correct it through the Cloudflare API. Safe to run on a
 * schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function wildcardCaaBlocked(caaRecords, desiredCa) {
  // Pure decision function. No network, no I/O.
  //
  // caaRecords is an array of [flags, tag, value] tuples parsed from the
  // apex CAA RRset. desiredCa is the CA identification domain the ACME
  // client will use, such as "letsencrypt.org".
  //
  // Returns [true, reason] if any issuewild record exists whose value is
  // not desiredCa or equals ";" (explicit deny), while at least one issue
  // record equals desiredCa. That combination means non-wildcard issuance
  // would succeed but wildcard issuance would fail.
  //
  // Returns [false, ""] otherwise: no issuewild present, or issuewild
  // already matches desiredCa.
  const issueValues = caaRecords.filter(([, tag]) => tag === "issue").map(([, , value]) => value);
  const issuewildValues = caaRecords.filter(([, tag]) => tag === "issuewild").map(([, , value]) => value);

  if (issuewildValues.length === 0) {
    return [false, ""];
  }

  if (!issueValues.includes(desiredCa)) {
    return [false, ""];
  }

  for (const value of issuewildValues) {
    if (value === ";") {
      return [true, `issuewild is set to deny all wildcard issuers (";"), but issue allows ${desiredCa}`];
    }
    if (value !== desiredCa) {
      return [true, `issuewild names ${value}, which does not match the issue value ${desiredCa}`];
    }
  }

  return [false, ""];
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const zoneApex = process.env.DNS_DOMAIN || "example.com";
  const desiredCa = process.env.DESIRED_CA || "letsencrypt.org";
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const answers = await resolvePromises.resolveCaa(zoneApex);
  // node:dns resolveCaa returns { critical, issue } or { critical, issuewild } shaped
  // entries, so normalize into (flags, tag, value) tuples first.
  const normalized = answers.map((a) => {
    const tag = a.issue !== undefined ? "issue" : a.issuewild !== undefined ? "issuewild" : "unknown";
    const value = a.issue !== undefined ? a.issue : a.issuewild;
    return [a.critical ? 128 : 0, tag, value];
  });

  const [blocked, reason] = wildcardCaaBlocked(normalized, desiredCa);
  if (!blocked) {
    console.log(`No wildcard-blocking issuewild mismatch found for ${zoneApex}`);
    return;
  }

  console.warn(`Wildcard issuance blocked for ${zoneApex}: ${reason}`);

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=CAA`,
    { headers },
  );
  if (!listRes.ok) throw new Error(`Cloudflare API returned ${listRes.status}`);
  const { result: records } = await listRes.json();

  const offending = records.find((r) => r.data && r.data.tag === "issuewild");

  const payload = {
    type: "CAA",
    name: zoneApex,
    data: { flags: 0, tag: "issuewild", value: desiredCa },
  };

  if (dryRun) {
    if (offending) {
      console.log(`Dry run: would update record ${offending.id} issuewild to ${desiredCa}`);
    } else {
      console.log(`Dry run: would create a new issuewild record set to ${desiredCa}`);
    }
    return;
  }

  if (offending) {
    const putRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${offending.id}`,
      { method: "PUT", headers, body: JSON.stringify(payload) },
    );
    if (!putRes.ok) throw new Error(`Cloudflare API returned ${putRes.status}`);
    console.log(`Updated issuewild record for ${zoneApex} to ${desiredCa}`);
  } else {
    const postRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      { method: "POST", headers, body: JSON.stringify(payload) },
    );
    if (!postRes.ok) throw new Error(`Cloudflare API returned ${postRes.status}`);
    console.log(`Created issuewild record for ${zoneApex} set to ${desiredCa}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
