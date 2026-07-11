/**
 * Detect a CAA record that blocks the intended certificate authority and,
 * on repair, add the missing issue record through the Cloudflare API. Safe
 * to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function caaPermitsCa(records, intendedCaDomain, isWildcard = false) {
  // Pure decision function. No DNS I/O, no network calls.
  //
  // records: array of [tag, value] pairs from the nearest non-empty CAA
  //          RRset found while walking up the DNS tree from the target
  //          name to the apex (empty array means no CAA record exists
  //          anywhere, so any CA is permitted).
  // intendedCaDomain: the CA's CAA identifier, e.g. "letsencrypt.org",
  //          "digicert.com", "pki.goog".
  // isWildcard: true if the certificate being requested is a wildcard
  //          cert (checks the "issuewild" tag, falling back to "issue"
  //          per RFC 8659 if no issuewild record is present).
  //
  // Returns [permitted, reason].
  if (records.length === 0) {
    return [true, "no CAA record anywhere in the tree, any CA is permitted"];
  }

  let tag = isWildcard ? "issuewild" : "issue";
  let tagged = records.filter(([recordTag]) => recordTag === tag).map(([, value]) => value);

  if (isWildcard && tagged.length === 0) {
    tag = "issue";
    tagged = records.filter(([recordTag]) => recordTag === tag).map(([, value]) => value);
  }

  if (tagged.length === 0) {
    return [true, `no ${tag} record present, so no restriction applies to this tag`];
  }

  for (const value of tagged) {
    if (value.trim() === ";") {
      return [false, `${tag} record is empty (0 ${tag} ";")`];
    }
  }

  for (const value of tagged) {
    const caPart = value.split(";")[0].trim();
    if (caPart === intendedCaDomain) {
      return [true, `${tag} record names ${intendedCaDomain}`];
    }
  }

  return [false, `no ${tag} record names ${intendedCaDomain}`];
}

function* climbLabels(name) {
  const labels = name.replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    yield labels.slice(i).join(".");
  }
  yield labels[labels.length - 1];
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const name = process.env.DNS_DOMAIN;
  const intendedCa = process.env.INTENDED_CA || "letsencrypt.org";
  const isWildcard = (process.env.IS_WILDCARD || "false").toLowerCase() === "true";
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

  let records = [];
  let checkedName = name;
  for (const candidate of climbLabels(name)) {
    try {
      const answer = await resolvePromises.resolveCaa(candidate);
      if (answer && answer.length > 0) {
        records = answer.map((r) => {
          if (r.issue !== undefined) return ["issue", r.issue];
          if (r.issuewild !== undefined) return ["issuewild", r.issuewild];
          if (r.iodef !== undefined) return ["iodef", r.iodef];
          return ["issue", ""];
        });
        checkedName = candidate;
        break;
      }
    } catch (err) {
      if (err.code !== "ENODATA" && err.code !== "ENOTFOUND") throw err;
    }
  }

  const [permitted, reason] = caaPermitsCa(records, intendedCa, isWildcard);
  console.log(`CAA at ${checkedName}: ${reason}`);

  if (permitted) {
    console.log(`No fix needed. ${intendedCa} is already permitted to issue.`);
    return;
  }

  console.warn(`Blocked: ${reason}`);

  const tag = isWildcard ? "issuewild" : "issue";

  if (dryRun) {
    console.log(`Dry run: would add CAA 0 ${tag} "${intendedCa}" to ${name}`);
    return;
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "CAA",
        name,
        data: { flags: 0, tag, value: intendedCa },
        ttl: 3600,
      }),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`Added CAA record permitting ${intendedCa} to issue for ${name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
