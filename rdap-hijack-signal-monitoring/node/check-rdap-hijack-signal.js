/**
 * Poll RDAP for a domain and diff it against a stored known-good snapshot to
 * catch the early signal of a hijack: a lost transfer lock, a nameserver you
 * did not configure, or a registrant/registrar change. Detect only:
 * re-locking the domain, resetting registrar credentials, or halting a
 * transfer are registrar and EPP-level actions this script cannot perform
 * through the Cloudflare DNS API, so it never writes anything, it only
 * reports what it finds.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH || "rdap_snapshot.json";

/**
 * Pure function, no I/O. baseline/current are shaped as:
 * { status: string[], nameservers: string[], registrant_handle: string,
 *   registrar_handle: string, last_changed: string }
 * Returns a list of human-readable alert strings. An empty array means no
 * hijack signal was detected.
 */
export function diffRdapSnapshot(baseline, current) {
  const alerts = [];

  const baselineStatus = new Set(baseline.status || []);
  const currentStatus = new Set(current.status || []);
  const lostLocks = [...baselineStatus].filter((s) => !currentStatus.has(s)).sort();
  for (const lock of lostLocks) {
    alerts.push(`status lost ${lock}`);
  }

  const baselineNs = baseline.nameservers || [];
  const currentNs = current.nameservers || [];
  const nsBaselineSet = new Set(baselineNs);
  const nsCurrentSet = new Set(currentNs);
  const nsEqual =
    nsBaselineSet.size === nsCurrentSet.size &&
    [...nsBaselineSet].every((ns) => nsCurrentSet.has(ns));
  if (!nsEqual) {
    alerts.push(`nameservers changed: ${JSON.stringify(baselineNs)} -> ${JSON.stringify(currentNs)}`);
  }

  if (baseline.registrant_handle !== current.registrant_handle) {
    alerts.push("registrant_handle changed");
  }

  if (baseline.registrar_handle !== current.registrar_handle) {
    alerts.push("registrar_handle changed");
  }

  if (baseline.last_changed !== current.last_changed) {
    alerts.push(`last_changed event moved: ${baseline.last_changed} -> ${current.last_changed}`);
  }

  return alerts;
}

/** Turn a raw RDAP JSON document into the flat shape diffRdapSnapshot expects. */
export function normalizeRdap(data) {
  const status = [...(data.status || [])].sort();
  const nameservers = (data.nameservers || [])
    .map((ns) => ns.ldhName)
    .filter(Boolean)
    .sort();

  let registrantHandle = null;
  let registrarHandle = null;
  for (const entity of data.entities || []) {
    const roles = entity.roles || [];
    if (roles.includes("registrant") && registrantHandle === null) {
      registrantHandle = entity.handle || null;
    }
    if (roles.includes("registrar") && registrarHandle === null) {
      registrarHandle = entity.handle || null;
    }
  }

  let lastChanged = null;
  for (const event of data.events || []) {
    if (event.eventAction === "last changed" || event.eventAction === "transfer") {
      lastChanged = event.eventDate || null;
    }
  }

  return {
    status,
    nameservers,
    registrant_handle: registrantHandle,
    registrar_handle: registrarHandle,
    last_changed: lastChanged,
  };
}

async function fetchRdap(domain) {
  // RDAP over HTTP via ICANN's public bootstrap redirector (RFC 9082 / 9083).
  const res = await fetch(`https://rdap.org/domain/${domain}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`RDAP lookup failed: ${res.status}`);
  return res.json();
}

async function loadBaseline(path) {
  const fs = await import("node:fs/promises");
  try {
    const text = await fs.readFile(path, "utf-8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function saveBaseline(path, snapshot) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function run() {
  console.log(`Polling RDAP for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const raw = await fetchRdap(DNS_DOMAIN);
  const current = normalizeRdap(raw);
  const baseline = await loadBaseline(SNAPSHOT_PATH);

  if (baseline === null) {
    console.log("No baseline snapshot yet. Saving current RDAP state as the trusted baseline.");
    await saveBaseline(SNAPSHOT_PATH, current);
    return;
  }

  const alerts = diffRdapSnapshot(baseline, current);

  if (alerts.length === 0) {
    console.log("OK: RDAP record matches the trusted baseline. No hijack signal.");
    return;
  }

  console.warn(`HIJACK SIGNAL for ${DNS_DOMAIN}:`);
  for (const alert of alerts) {
    console.warn(`  - ${alert}`);
  }
  console.warn(
    "This is a registrar-side action, not something the Cloudflare DNS API can fix. " +
    "Re-lock the domain, reset registrar credentials and MFA, or contact the registrar's " +
    "abuse team / ICANN's Transfer Emergency Action Contact (TEAC)."
  );

  // Note for future readers: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are
  // accepted for consistency with the other fixes in this repo, and would be
  // used to manage records inside a zone already delegated to Cloudflare via
  // https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records, but
  // that endpoint has no way to re-lock a domain or change registrar-level
  // ownership fields, so this script never calls it.
  if (!DRY_RUN) {
    console.log("DRY_RUN is false, but this check never writes. Fix the registrar by hand.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
