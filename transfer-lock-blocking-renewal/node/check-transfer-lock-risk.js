/**
 * Detect a domain that is both transfer-locked and close to expiring.
 * Detection only. Removing a registrar transfer lock is an account or
 * registrar-portal action, not a Cloudflare DNS zone API call, so this
 * script never attempts a repair, it only reports the risky combination.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const WARNING_DAYS = Number(process.env.WARNING_DAYS || 30);

const LOCK_STATUSES = new Set(["clienttransferprohibited", "servertransferprohibited"]);

/**
 * Pure decision logic, no I/O.
 * Input: statusCodes (raw RDAP/WHOIS status strings, any case/spacing),
 *        expirationDate (the domain's expiration as a Date),
 *        now (the current time as a Date, injected for testability),
 *        warningDays (how many days out counts as "near expiry").
 * Output: { locked: boolean, daysUntilExpiry: number, atRisk: boolean }
 * Logic: normalize statusCodes to lowercase with spaces removed, and check
 * membership against clienttransferprohibited/servertransferprohibited.
 * Compute daysUntilExpiry as the whole number of days between now and
 * expirationDate. atRisk is true only when locked is true AND
 * daysUntilExpiry <= warningDays AND daysUntilExpiry >= 0.
 */
export function assessTransferRisk(statusCodes, expirationDate, now, warningDays = 30) {
  const normalized = new Set(statusCodes.map((s) => s.toLowerCase().replace(/\s+/g, "")));
  const locked = [...LOCK_STATUSES].some((s) => normalized.has(s));
  const daysUntilExpiry = Math.floor((expirationDate.getTime() - now.getTime()) / 86400000);

  const atRisk = locked && daysUntilExpiry >= 0 && daysUntilExpiry <= warningDays;

  return { locked, daysUntilExpiry, atRisk };
}

/** Query RDAP for a domain and return the raw JSON response. */
async function fetchRdap(domain) {
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP returned ${res.status} for ${domain}`);
  return res.json();
}

/** Pull the expiration eventDate out of an RDAP response. */
function extractExpiration(rdapData) {
  const event = (rdapData.events || []).find((e) => e.eventAction === "expiration");
  if (!event) throw new Error("No expiration event found in RDAP response");
  return new Date(event.eventDate);
}

/** Report the finding. Replace with email, Slack, or a webhook in production. */
function report(domain, result, statusCodes) {
  if (!result.atRisk) {
    console.log(
      `OK: ${domain} locked=${result.locked}, ${result.daysUntilExpiry} day(s) until expiry, no action needed`
    );
    return;
  }
  const prefix = DRY_RUN ? "[dry run] would flag" : "FLAG";
  console.warn(
    `${prefix}: ${domain} is transfer-locked with only ${result.daysUntilExpiry} day(s) left before expiry. ` +
    `statuses=${JSON.stringify(statusCodes)}. Unlock at the registrar dashboard, or let auto-renew process first. ` +
    "This cannot be fixed through the Cloudflare DNS zone API."
  );
}

export async function run() {
  console.log(`Checking transfer lock risk for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const rdapData = await fetchRdap(DNS_DOMAIN);
  const statusCodes = rdapData.status || [];
  const expirationDate = extractExpiration(rdapData);
  const now = new Date();

  const result = assessTransferRisk(statusCodes, expirationDate, now, WARNING_DAYS);
  report(DNS_DOMAIN, result, statusCodes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
