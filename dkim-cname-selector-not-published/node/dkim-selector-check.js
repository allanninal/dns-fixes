/**
 * Check that both Microsoft 365 DKIM CNAME selectors are published correctly,
 * and optionally repair them through the Cloudflare API.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. yourdomain.com
 *   DKIM_SELECTOR1_TARGET    expected CNAME target for selector1, from
 *                            Get-DkimSigningConfig -Identity yourdomain.com
 *   DKIM_SELECTOR2_TARGET    expected CNAME target for selector2
 *   CLOUDFLARE_API_TOKEN     only needed for repair
 *   CLOUDFLARE_ZONE_ID       only needed for repair
 *   DRY_RUN                  defaults to "true"
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "yourdomain.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * selectorRecords: { selector1: { type: "CNAME"|"TXT"|null, target: string|null }, selector2: {...} }
 * expectedTargets: { selector1: "selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com", selector2: "..." }
 *
 * Returns a list of finding objects like
 *   { selector: "selector2", issue: "missing"|"wrong_type"|"target_mismatch", found: ..., expected: ... }
 * for each selector that fails to resolve as a CNAME to its expected target.
 * An empty array means healthy.
 */
export function checkDkimSelectors(selectorRecords, expectedTargets) {
  const findings = [];
  for (const [selector, expected] of Object.entries(expectedTargets)) {
    const record = selectorRecords[selector] || { type: null, target: null };
    const { type, target } = record;

    if (type === null || type === undefined) {
      findings.push({ selector, issue: "missing", found: null, expected });
      continue;
    }
    if (type !== "CNAME") {
      findings.push({ selector, issue: "wrong_type", found: type, expected });
      continue;
    }
    if (target !== expected) {
      findings.push({ selector, issue: "target_mismatch", found: target, expected });
    }
  }
  return findings;
}

/** Query CNAME (and TXT, to detect a wrong-type conflict) for both selectors. */
async function querySelectorRecords(domain) {
  const dns = await import("node:dns/promises");
  const records = {};
  for (const selector of ["selector1", "selector2"]) {
    const name = `${selector}._domainkey.${domain}`;
    try {
      const answer = await dns.resolveCname(name);
      records[selector] = { type: "CNAME", target: answer[0].replace(/\.$/, "") };
      continue;
    } catch {
      // fall through to check TXT
    }
    try {
      await dns.resolveTxt(name);
      records[selector] = { type: "TXT", target: null };
    } catch {
      records[selector] = { type: null, target: null };
    }
  }
  return records;
}

/** Find an existing record of recordType at the selector name via the Cloudflare API. */
async function findConflictingRecordId(domain, selector, recordType) {
  const name = `${selector}._domainkey.${domain}`;
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${recordType}&name=${name}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare list failed: ${res.status}`);
  const body = await res.json();
  const result = body.result || [];
  return result.length ? result[0].id : null;
}

/** Delete a conflicting TXT record, if any, then create the correct CNAME. */
async function publishSelectorCname(domain, selector, target, conflictingTxtId) {
  const name = `${selector}._domainkey.${domain}`;
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const base = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`;

  if (DRY_RUN) {
    if (conflictingTxtId) console.log(`[dry run] would delete TXT record ${conflictingTxtId} at ${name}`);
    console.log(`[dry run] would create CNAME ${name} -> ${target}`);
    return;
  }

  if (conflictingTxtId) {
    const del = await fetch(`${base}/${conflictingTxtId}`, { method: "DELETE", headers });
    if (!del.ok) throw new Error(`Cloudflare delete failed: ${del.status}`);
  }

  const create = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "CNAME", name, content: target, proxied: false }),
  });
  if (!create.ok) throw new Error(`Cloudflare create failed: ${create.status}`);
  console.log(`Published CNAME ${name} -> ${target}`);
}

async function run() {
  const expectedTargets = {
    selector1: process.env.DKIM_SELECTOR1_TARGET || "",
    selector2: process.env.DKIM_SELECTOR2_TARGET || "",
  };
  if (!expectedTargets.selector1 || !expectedTargets.selector2) {
    console.warn("Set DKIM_SELECTOR1_TARGET and DKIM_SELECTOR2_TARGET from Get-DkimSigningConfig first.");
    return;
  }

  const records = await querySelectorRecords(DNS_DOMAIN);
  const findings = checkDkimSelectors(records, expectedTargets);

  if (findings.length === 0) {
    console.log(`Both DKIM selectors are healthy for ${DNS_DOMAIN}.`);
    return;
  }

  for (const finding of findings) {
    console.warn(`selector=${finding.selector} issue=${finding.issue} found=${finding.found} expected=${finding.expected}`);
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("Issues found but no Cloudflare credentials set. Skipping repair.");
    return;
  }

  for (const finding of findings) {
    let conflictingTxtId = null;
    if (finding.issue === "wrong_type") {
      conflictingTxtId = await findConflictingRecordId(DNS_DOMAIN, finding.selector, "TXT");
    }
    await publishSelectorCname(DNS_DOMAIN, finding.selector, finding.expected, conflictingTxtId);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
