/**
 * Detect and repair a false-positive duplicate record conflict caused by
 * a dedup/reconciler check that only keys on (name, type) instead of the
 * provider's real identity key of (name, type, set_identifier).
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the name to check, e.g. "acme.example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CF_API = "https://api.cloudflare.com/client/v4";

export function isDuplicateRecord(existing, candidate) {
  // Pure decision function. No I/O.
  // existing/candidate keys: name (lowercased FQDN string), type (string),
  // setIdentifier (string|null), content (string, e.g. IP or target).
  // Returns true only if the records are truly the same record set.
  // Route53-style: identity key is (name, type, setIdentifier).
  // Provider-without-set-id (e.g. Cloudflare A/AAAA multivalue): fall back
  // to (name, type, content) so distinct values are never merged.
  const sameName = existing.name.replace(/\.$/, "").toLowerCase() ===
    candidate.name.replace(/\.$/, "").toLowerCase();
  const sameType = existing.type.toUpperCase() === candidate.type.toUpperCase();
  if (!(sameName && sameType)) return false;
  if (existing.setIdentifier || candidate.setIdentifier) {
    return existing.setIdentifier === candidate.setIdentifier;
  }
  return existing.content === candidate.content;
}

export function findRealConflicts(existingRecords, intendedRecords) {
  // Given the live zone and the intended record list, return only the
  // intended records that are true duplicates of something already live.
  // Everything else (a new setIdentifier, a new value) is not a conflict
  // and should be allowed through.
  const conflicts = [];
  for (const candidate of intendedRecords) {
    if (existingRecords.some((existing) => isDuplicateRecord(existing, candidate))) {
      conflicts.push(candidate);
    }
  }
  return conflicts;
}

async function listZoneRecords(name) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ per_page: "5000" });
  if (name) params.set("name", name);
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result.map((rec) => ({
    name: rec.name,
    type: rec.type,
    content: rec.content,
    setIdentifier: null, // Cloudflare has no SetIdentifier concept
    id: rec.id,
  }));

  // For Route 53 instead, this would use the AWS SDK v3 Route 53 client
  // and read rrset.SetIdentifier off each ResourceRecordSet.
}

async function applyRecord(candidate) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const body = {
    type: candidate.type,
    name: candidate.name,
    content: candidate.content,
    ttl: candidate.ttl || 300,
  };
  if (DRY_RUN) {
    console.log(`[dry run] would apply record ${JSON.stringify(body)}`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cloudflare create returned ${res.status}`);
  console.log(`Applied record ${JSON.stringify(body)}`);
}

async function run() {
  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn(`No Cloudflare credentials set. Nothing to check for ${DNS_DOMAIN}.`);
    return;
  }

  const existingRecords = await listZoneRecords(DNS_DOMAIN);

  // The "intended" list normally comes from source control. This is a
  // stand-in example of a second weighted record that a bad
  // (name, type)-only dedup check would have blocked.
  const intendedRecords = [
    {
      name: DNS_DOMAIN,
      type: "A",
      setIdentifier: "us-east-secondary",
      content: "192.0.2.11",
      ttl: 60,
    },
  ];

  const realConflicts = findRealConflicts(existingRecords, intendedRecords);
  const falsePositives = intendedRecords.filter((r) => !realConflicts.includes(r));

  if (falsePositives.length > 0) {
    console.log(`${falsePositives.length} record(s) were not real duplicates and will be applied.`);
  }
  for (const record of falsePositives) {
    await applyRecord(record);
  }

  if (realConflicts.length > 0) {
    console.warn(
      `${realConflicts.length} record(s) are true duplicates (same name, type, and ` +
      `setIdentifier or content) and were skipped.`,
    );
  }

  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
