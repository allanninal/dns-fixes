/**
 * Detect a broken DNSSEC chain that turns a CAA lookup into a SERVFAIL and,
 * optionally, check or change a Cloudflare zone's DNSSEC status. Safe to
 * run on a schedule. Stays in dry run until DRY_RUN=false.
 */
import { pathToFileURL } from "node:url";

export function diagnoseCaaDnssecBreak(servfailWithValidation, okWithCd, dsMatchesDnskey, rrsigExpired) {
  // Pure decision function. No DNS I/O, no network calls.
  //
  // servfailWithValidation: true if the CAA query against a validating
  //   resolver (e.g. dig @1.1.1.1 CAA example.com) returned SERVFAIL.
  // okWithCd: true if the same query with checking disabled
  //   (dig @1.1.1.1 +cd CAA example.com) returned NOERROR.
  // dsMatchesDnskey: true if the DS digest at the registrar matches a
  //   hash of the DNSKEY currently signing the zone.
  // rrsigExpired: true if the RRSIG over DNSKEY or CAA has passed its
  //   validity window.
  //
  // Returns one of "ok", "broken_dnssec_chain_ds_mismatch",
  // "broken_dnssec_chain_expired_rrsig", "not_dnssec_related".
  if (!servfailWithValidation) return "ok";
  if (!okWithCd) return "not_dnssec_related";
  if (rrsigExpired) return "broken_dnssec_chain_expired_rrsig";
  return "broken_dnssec_chain_ds_mismatch";
}

async function digStatus(execFileAsync, args) {
  try {
    const { stdout } = await execFileAsync("dig", args);
    const match = stdout.match(/status:\s*(\w+)/);
    return match ? match[1] : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export async function run() {
  // Imported lazily so the pure function above can be tested with no
  // network modules or child processes touched at all.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const domain = process.env.DNS_DOMAIN || "example.com";
  const resolverIp = process.env.VALIDATING_RESOLVER || "1.1.1.1";
  const dryRun = (process.env.DRY_RUN || "true").toLowerCase() === "true";

  const plainStatus = await digStatus(execFileAsync, ["@" + resolverIp, "CAA", domain]);
  const servfailWithValidation = plainStatus === "SERVFAIL";

  const cdStatus = await digStatus(execFileAsync, ["@" + resolverIp, "+cd", "CAA", domain]);
  const okWithCd = cdStatus === "NOERROR";

  // The DS-to-DNSKEY digest comparison and RRSIG expiry check use full
  // cryptographic digest math (dnspython's make_ds) in the Python version
  // of this script. The Node version reports the SERVFAIL / +cd signal,
  // which is already enough to confirm DNSSEC is the cause, and treats an
  // unresolved digest comparison as a mismatch so the operator is pointed
  // at the registrar DS record rather than told everything is fine.
  const dsMatchesDnskey = false;
  const rrsigExpired = false;

  const verdict = diagnoseCaaDnssecBreak(servfailWithValidation, okWithCd, dsMatchesDnskey, rrsigExpired);
  console.log(`Diagnosis for ${domain}: ${verdict}`);

  if (verdict === "ok") {
    console.log("CAA resolves fine through a validating resolver. Nothing to do.");
    return;
  }

  if (verdict === "not_dnssec_related") {
    console.warn(
      "SERVFAIL does not clear with +cd, so this looks like a dead " +
      "nameserver or network issue, not a broken DNSSEC chain."
    );
    return;
  }

  console.warn(`Broken DNSSEC chain detected: ${verdict}`);

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) {
    console.log(
      "No Cloudflare credentials set. Fix the DS record at the registrar, " +
      "or disable DNSSEC in the correct order, then re-run."
    );
    return;
  }

  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dnssec`, { headers });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  const body = await res.json();
  const status = body.result.status;
  console.log(`Cloudflare zone DNSSEC status is currently: ${status}`);

  if (dryRun) {
    console.log("Dry run: would not change DNSSEC status automatically.");
    return;
  }

  const disableDnssec = (process.env.DISABLE_DNSSEC || "false").toLowerCase() === "true";
  if (disableDnssec && status === "active") {
    console.warn(
      "DISABLE_DNSSEC=true, but the DS record must already be removed at " +
      "the registrar and its TTL must have expired before this runs, " +
      "otherwise this recreates the exact SERVFAIL problem."
    );
    const patch = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dnssec`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "disabled" }),
    });
    if (!patch.ok) throw new Error(`Cloudflare API returned ${patch.status}`);
    console.log("Requested Cloudflare to disable DNSSEC for this zone.");
  } else {
    console.log(
      "Updating the DS record itself is a registrar action outside the " +
      "Cloudflare DNS records API. Get the current DS data from DNS > " +
      "Settings > DNSSEC in the Cloudflare dashboard and paste it into " +
      "the registrar's DS records page."
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
