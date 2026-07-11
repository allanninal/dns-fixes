/**
 * Check a domain's real expiration date over RDAP and alert when it crosses
 * a warning threshold. Renewal itself always happens at the registrar, since
 * this is a billing state, not a DNS zone record. DRY_RUN only reports until
 * turned off, and even then this script only sends alerts, it never renews
 * anything on your behalf.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const WARN_THRESHOLDS_DAYS = [30, 14, 7, 1];

/**
 * Pure decision logic, no I/O.
 * Input: expirationIso (RDAP eventDate string, e.g. '2026-08-05T04:00:00Z'),
 *        nowIso (current time as ISO string, injected for testability),
 *        warnThresholdsDays (sorted descending array of alert thresholds).
 * Output: {
 *   daysRemaining: number,
 *   severity: 'ok' | 'warning' | 'critical' | 'expired',
 *   triggeredThreshold: number | null
 * }
 * Logic: parse both timestamps, compute
 * daysRemaining = floor((expiration - now) / 86400000).
 * If daysRemaining < 0: severity = 'expired'.
 * Else find the smallest threshold in warnThresholdsDays that is >= daysRemaining;
 * if none found, severity = 'ok', triggeredThreshold = null;
 * else severity = 'critical' if triggeredThreshold <= 7 else 'warning'.
 */
export function daysUntilExpiry(expirationIso, nowIso, warnThresholdsDays = [30, 14, 7, 1]) {
  const expiration = new Date(expirationIso);
  const now = new Date(nowIso);
  const daysRemaining = Math.floor((expiration.getTime() - now.getTime()) / 86400000);

  if (daysRemaining < 0) {
    return { daysRemaining, severity: "expired", triggeredThreshold: null };
  }

  const candidates = warnThresholdsDays.filter((t) => t >= daysRemaining);
  const triggeredThreshold = candidates.length > 0 ? Math.min(...candidates) : null;

  let severity;
  if (triggeredThreshold === null) {
    severity = "ok";
  } else if (triggeredThreshold <= 7) {
    severity = "critical";
  } else {
    severity = "warning";
  }

  return { daysRemaining, severity, triggeredThreshold };
}

/** Query RDAP for a domain and return the expiration eventDate string. */
async function fetchRdapExpiration(domain) {
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP returned ${res.status} for ${domain}`);
  const data = await res.json();
  const event = (data.events || []).find((e) => e.eventAction === "expiration");
  if (!event) throw new Error(`No expiration event found in RDAP response for ${domain}`);
  return event.eventDate;
}

/** Query RDAP for a domain and return its status list. */
async function fetchRdapStatus(domain) {
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP returned ${res.status} for ${domain}`);
  const data = await res.json();
  return data.status || [];
}

/** Send an alert. Replace with email, Slack, or a webhook call in production. */
function sendAlert(domain, result, statuses) {
  if (DRY_RUN) {
    console.log(
      `[dry run] would alert: ${domain} is ${result.severity}, ${result.daysRemaining} day(s) remaining, statuses=${JSON.stringify(statuses)}`
    );
    return;
  }
  console.warn(
    `ALERT: ${domain} is ${result.severity}, ${result.daysRemaining} day(s) remaining, statuses=${JSON.stringify(statuses)}. ` +
    "Renew at the registrar, this cannot be fixed through the DNS provider API."
  );
}

export async function run() {
  console.log(`Checking domain expiration for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const expirationIso = await fetchRdapExpiration(DNS_DOMAIN);
  const statuses = await fetchRdapStatus(DNS_DOMAIN);
  const nowIso = new Date().toISOString();

  const result = daysUntilExpiry(expirationIso, nowIso, WARN_THRESHOLDS_DAYS);
  console.log(
    `${DNS_DOMAIN} expires ${expirationIso}: ${result.daysRemaining} day(s) remaining, severity=${result.severity}`
  );

  const graceFlags = new Set(["pendingdelete", "redemptionperiod", "autorenewperiod"]);
  const loweredStatuses = statuses.map((s) => s.toLowerCase());
  if (loweredStatuses.some((s) => graceFlags.has(s))) {
    console.warn(`${DNS_DOMAIN} is already in a grace or pending-delete state: ${JSON.stringify(statuses)}`);
    sendAlert(DNS_DOMAIN, result, statuses);
    return;
  }

  if (["warning", "critical", "expired"].includes(result.severity)) {
    sendAlert(DNS_DOMAIN, result, statuses);
  } else {
    console.log(`OK: ${DNS_DOMAIN} has plenty of runway left before renewal is needed.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
