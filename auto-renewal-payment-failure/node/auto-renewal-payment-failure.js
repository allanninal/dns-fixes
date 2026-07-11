/**
 * Detect a stalled auto-renewal caused by a failed payment charge, using
 * RDAP as the source of truth, and reconcile the CAA iodef alert record
 * through the Cloudflare API. Renewing the domain itself always happens at
 * the registrar, since that is a billing action, not a DNS zone record.
 * Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

const GRACE_STATUSES = new Set(["autorenewperiod", "redemptionperiod", "pendingdelete"]);

/**
 * Pure decision function. No I/O.
 *
 * expirationIso: current RDAP expiration eventDate string.
 * previousExpirationIso: expiration eventDate recorded on a prior run,
 *   or null if this is the first run.
 * nowIso: current time as an ISO string, injected for testability.
 * statuses: array of RDAP status strings for the domain.
 * warnDays: how many days out counts as inside the warning window.
 *
 * Returns:
 *   daysRemaining: number
 *   stalled: boolean, true if the expiration date did not move forward
 *            since the previous check
 *   inGracePeriod: boolean, true if any status flags a lapsed domain
 *   paymentLikelyFailed: boolean, true when the domain is inside the
 *            warning window and either stalled or already in a grace
 *            period, which points at a failed auto-renew charge
 */
export function evaluateRenewal(expirationIso, previousExpirationIso, nowIso, statuses, warnDays = 30) {
  const expiration = new Date(expirationIso);
  const now = new Date(nowIso);
  const daysRemaining = Math.floor((expiration.getTime() - now.getTime()) / 86400000);

  let stalled = false;
  if (previousExpirationIso) {
    const previous = new Date(previousExpirationIso);
    stalled = expiration.getTime() <= previous.getTime();
  }

  const lowered = new Set(statuses.map((s) => s.toLowerCase()));
  const inGracePeriod = [...lowered].some((s) => GRACE_STATUSES.has(s));

  const insideWindow = daysRemaining <= warnDays;
  const paymentLikelyFailed = inGracePeriod || (insideWindow && stalled);

  return { daysRemaining, stalled, inGracePeriod, paymentLikelyFailed };
}

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const ALERT_CONTACT_URI = process.env.ALERT_CONTACT_URI || "mailto:domains@example.com";
const PREVIOUS_EXPIRATION_ISO = process.env.PREVIOUS_EXPIRATION_ISO || null;

async function fetchRdap(domain) {
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error(`RDAP returned ${res.status} for ${domain}`);
  const data = await res.json();
  const event = (data.events || []).find((e) => e.eventAction === "expiration");
  if (!event) throw new Error(`No expiration event found in RDAP response for ${domain}`);
  return { expirationIso: event.eventDate, statuses: data.status || [] };
}

async function findCaaIodefRecord(zoneId, headers, name) {
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=CAA&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  const data = await res.json();
  return (data.result || []).find((r) => r.data && r.data.tag === "iodef") || null;
}

async function reconcileIodefRecord(zoneId, headers, name, contactUri, dryRun) {
  const existing = await findCaaIodefRecord(zoneId, headers, name);
  const body = { type: "CAA", name, data: { flags: 0, tag: "iodef", value: contactUri }, ttl: 3600 };

  if (existing && existing.data.value === contactUri) {
    console.log(`CAA iodef record already points at ${contactUri}, nothing to change.`);
    return;
  }

  if (dryRun) {
    console.log(`Dry run: would ${existing ? "update" : "create"} CAA iodef record on ${name} to ${contactUri}`);
    return;
  }

  const url = existing
    ? `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`
    : `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
  const res = await fetch(url, { method: existing ? "PUT" : "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`CAA iodef record on ${name} now points at ${contactUri}`);
}

export async function run() {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };

  const { expirationIso, statuses } = await fetchRdap(DNS_DOMAIN);
  const nowIso = new Date().toISOString();

  const result = evaluateRenewal(expirationIso, PREVIOUS_EXPIRATION_ISO, nowIso, statuses);
  console.log(
    `${DNS_DOMAIN} expires ${expirationIso}: ${result.daysRemaining} day(s) remaining, stalled=${result.stalled}, inGracePeriod=${result.inGracePeriod}`
  );

  if (!result.paymentLikelyFailed) {
    console.log(`OK: ${DNS_DOMAIN} renewed on schedule, no sign of a failed charge.`);
    return;
  }

  console.warn(
    `Renewal for ${DNS_DOMAIN} looks stalled. Auto-renew is likely failing at the payment step. ` +
    "Update the card or pay manually at the registrar, this cannot be fixed through the DNS provider API."
  );
  await reconcileIodefRecord(CLOUDFLARE_ZONE_ID, headers, DNS_DOMAIN, ALERT_CONTACT_URI, DRY_RUN);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
