/**
 * Detect an SPF record that exceeds the 10 DNS lookup limit and, on
 * repair, replace it with a flattened record through the Cloudflare API.
 * Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

const LOOKUP_MECHANISMS = ["include", "a", "mx", "ptr", "exists"];

export function countSpfLookups(spfRecord, resolver, _depth = 0, _seen = null) {
  // Pure decision function. No DNS I/O, no network calls.
  //
  // spfRecord: the raw SPF string, e.g. "v=spf1 include:_spf.google.com ~all".
  // resolver: a function resolver(kind, name) -> string[] that the caller
  //           injects. kind is "TXT" for include/redirect lookups. The
  //           real run() wires this to node:dns; tests wire it to a fake
  //           object or Map.
  // _depth, _seen: internal recursion guards (max depth 10 per RFC 7208,
  //           a seen-set to avoid infinite loops on a misconfigured chain).
  //
  // Returns [totalLookupCount, warnings].
  const seen = _seen || new Set();
  const warnings = [];
  let count = 0;

  if (_depth > 10) {
    warnings.push("recursion depth exceeded 10, stopping (likely a loop)");
    return [count, warnings];
  }

  const tokens = spfRecord.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const mechanism = token.replace(/^[+\-~?]/, "");

    let matched = false;
    for (const kind of LOOKUP_MECHANISMS) {
      if (mechanism === kind || mechanism.startsWith(kind + ":") || mechanism.startsWith(kind + "/")) {
        matched = true;
        count += 1;
        if (mechanism.startsWith("include:")) {
          const target = mechanism.split(":").slice(1).join(":");
          if (seen.has(target)) {
            warnings.push(`include:${target} already visited, skipping to avoid a loop`);
            break;
          }
          seen.add(target);
          const includedTxt = resolver("TXT", target);
          const includedRecord = includedTxt.find((r) => r.startsWith("v=spf1"));
          if (!includedRecord) {
            warnings.push(`include:${target} returned no usable SPF record (void lookup)`);
            break;
          }
          const [nestedCount, nestedWarnings] = countSpfLookups(includedRecord, resolver, _depth + 1, seen);
          count += nestedCount;
          warnings.push(...nestedWarnings);
        }
        break;
      }
    }
    if (matched) continue;

    if (mechanism.startsWith("redirect=")) {
      count += 1;
      const target = mechanism.split("=").slice(1).join("=");
      if (seen.has(target)) {
        warnings.push(`redirect=${target} already visited, skipping to avoid a loop`);
        continue;
      }
      seen.add(target);
      const redirectedTxt = resolver("TXT", target);
      const redirectedRecord = redirectedTxt.find((r) => r.startsWith("v=spf1"));
      if (!redirectedRecord) {
        warnings.push(`redirect=${target} returned no usable SPF record (void lookup)`);
        continue;
      }
      const [nestedCount, nestedWarnings] = countSpfLookups(redirectedRecord, resolver, _depth + 1, seen);
      count += nestedCount;
      warnings.push(...nestedWarnings);
    }
  }

  if (count > 10 && !warnings.some((w) => w.includes("exceeds 10-lookup limit"))) {
    warnings.push(`exceeds 10-lookup limit (${count} found)`);
  }

  return [count, warnings];
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules touched at all.
  const dns = await import("node:dns");
  const resolvePromises = dns.promises;

  const domain = process.env.DNS_DOMAIN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

  async function resolveTxt(kind, name) {
    try {
      const rows = await resolvePromises.resolveTxt(name);
      return rows.map((parts) => parts.join(""));
    } catch (err) {
      if (err.code === "ENODATA" || err.code === "ENOTFOUND" || err.code === "ETIMEOUT") return [];
      throw err;
    }
  }

  // countSpfLookups expects a synchronous resolver, so we pre-resolve the
  // whole chain breadth-first into a lookup table, then hand the pure
  // function a synchronous accessor backed by that table.
  async function buildResolverTable(rootRecord) {
    const table = new Map();
    const queue = [];
    const seen = new Set();

    const queueTargetsFrom = (record) => {
      for (const token of record.split(/\s+/).filter(Boolean)) {
        const mech = token.replace(/^[+\-~?]/, "");
        if (mech.startsWith("include:")) queue.push(mech.split(":").slice(1).join(":"));
        if (mech.startsWith("redirect=")) queue.push(mech.split("=").slice(1).join("="));
      }
    };

    queueTargetsFrom(rootRecord);
    while (queue.length > 0) {
      const target = queue.shift();
      if (seen.has(target)) continue;
      seen.add(target);
      const txt = await resolveTxt("TXT", target);
      table.set(target, txt);
      const nested = txt.find((r) => r.startsWith("v=spf1"));
      if (nested) queueTargetsFrom(nested);
    }
    return table;
  }

  const rootAnswers = await resolveTxt("TXT", domain);
  const spfRecord = rootAnswers.find((r) => r.startsWith("v=spf1"));
  if (!spfRecord) {
    console.warn(`No SPF record found at ${domain}`);
    return;
  }

  const table = await buildResolverTable(spfRecord);
  const syncResolver = (_kind, name) => table.get(name) || [];

  const [total, warnings] = countSpfLookups(spfRecord, syncResolver);
  console.log(`SPF at ${domain} uses ${total} lookup(s)`);
  for (const w of warnings) console.warn(w);

  if (total <= 10) {
    console.log("No fix needed. Lookup count is within the limit.");
    return;
  }

  const staticTokens = spfRecord.split(/\s+/).filter(
    (t) => t.startsWith("ip4:") || t.startsWith("ip6:") || t.startsWith("v=spf1")
  );
  const flattenedRecord = [...staticTokens, "-all"].join(" ");

  console.warn(`SPF exceeds the limit: ${total} lookups. Proposed flattened record: ${flattenedRecord}`);

  if (dryRun) {
    console.log(`Dry run: would replace TXT record at ${domain} with: ${flattenedRecord}`);
    return;
  }

  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(domain)}`,
    { headers }
  );
  if (!listRes.ok) throw new Error(`Cloudflare API list returned ${listRes.status}`);
  const listBody = await listRes.json();
  const record = (listBody.result || []).find((r) => (r.content || "").replace(/^"|"$/g, "").startsWith("v=spf1"));
  if (!record) {
    console.warn(`No existing SPF TXT record id found to update at ${domain}`);
    return;
  }

  const patchRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ type: "TXT", name: domain, content: flattenedRecord }),
    }
  );
  if (!patchRes.ok) throw new Error(`Cloudflare API patch returned ${patchRes.status}`);
  console.log(`Replaced SPF TXT record at ${domain} with a flattened record under the limit`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
