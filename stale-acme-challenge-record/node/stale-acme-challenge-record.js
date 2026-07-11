/**
 * Detect a stale _acme-challenge TXT record left behind by a failed
 * ACME DNS-01 renewal, and optionally repair the zone via Cloudflare
 * by deleting the stale record(s).
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   CURRENT_CHALLENGE_TOKEN  the token the ACME client is currently
 *                            trying to validate, if any (leave unset
 *                            or empty when no validation is in flight)
 *   STALE_TIMEOUT_SECONDS    default 3600; age past which a record is
 *                            always considered stale
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CURRENT_CHALLENGE_TOKEN = process.env.CURRENT_CHALLENGE_TOKEN || null;
const STALE_TIMEOUT_SECONDS = Number(process.env.STALE_TIMEOUT_SECONDS || 3600);
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";
const GRACE_SECONDS = 300;

export function findStaleChallengeRecords(records, currentToken, nowTs, timeoutS = 3600) {
  // Pure decision function. No I/O.
  //
  // records: list of TXT record objects for _acme-challenge.<domain>,
  // each with 'id', 'content', and 'modified_on' as epoch seconds.
  // currentToken: the token the ACME client is currently trying to
  // validate, or null if no validation is in flight.
  // nowTs: the current time as epoch seconds.
  // timeoutS: age in seconds past which a record is always stale,
  // regardless of its content, since a real challenge never takes
  // anywhere near this long.
  //
  // Returns the list of record ids that are stale: any record older
  // than timeoutS, or, when currentToken is not null, any record
  // whose content differs from currentToken once it is older than a
  // short grace period.
  const staleIds = [];
  for (const record of records) {
    const age = nowTs - record.modified_on;
    if (age > timeoutS) {
      staleIds.push(record.id);
      continue;
    }
    if (currentToken !== null && record.content !== currentToken && age > GRACE_SECONDS) {
      staleIds.push(record.id);
    }
  }
  return staleIds;
}

async function listChallengeRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: "TXT", name: `_acme-challenge.${domain}`, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result;
}

async function deleteRecord(recordId) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  if (DRY_RUN) {
    console.log(`[dry run] would delete record ${recordId}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Cloudflare delete returned ${res.status}`);
  console.log(`Deleted record ${recordId}`);
}

async function run() {
  const records = await listChallengeRecords(DNS_DOMAIN);
  if (records.length === 0) {
    console.log(`No _acme-challenge TXT records found for ${DNS_DOMAIN}.`);
    return;
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const staleIds = findStaleChallengeRecords(records, CURRENT_CHALLENGE_TOKEN, nowTs, STALE_TIMEOUT_SECONDS);
  if (staleIds.length === 0) {
    console.log(`All ${records.length} TXT record(s) at _acme-challenge.${DNS_DOMAIN} look current.`);
    return;
  }

  for (const recordId of staleIds) {
    console.warn(`Stale _acme-challenge TXT record for ${DNS_DOMAIN}: id ${recordId}`);
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  for (const recordId of staleIds) {
    await deleteRecord(recordId);
  }
  console.log(`Done. ${staleIds.length} stale record(s) ${DRY_RUN ? "would be removed" : "removed"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
