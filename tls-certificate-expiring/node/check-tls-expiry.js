/**
 * Check a host's live TLS certificate expiry over a raw socket, and if the
 * failure is a missing or wrong CAA record, repair it through the Cloudflare
 * DNS API. Safe by default: DRY_RUN only reports the plan until turned off.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CA_TO_PERMIT = process.env.CA_TO_PERMIT || "letsencrypt.org";
const WARN_AT_DAYS = Number(process.env.WARN_AT_DAYS || 21);
const CRIT_AT_DAYS = Number(process.env.CRIT_AT_DAYS || 7);

/** Pure function, no I/O. Both dates should be Date objects. */
export function daysUntilExpiry(notAfter, now) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((notAfter.getTime() - now.getTime()) / msPerDay);
}

/** Pure function, no I/O. Classifies remaining days into a severity. */
export function classify(days, warnAt = 21, critAt = 7) {
  if (days < 0) return "expired";
  if (days <= critAt) return "critical";
  if (days <= warnAt) return "warn";
  return "ok";
}

/** Open a raw TLS socket with SNI set and read the peer certificate. */
async function fetchPeerCertificate(host, port = 443) {
  const tls = await import("node:tls");
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, timeout: 15000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      }
    );
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
  });
}

/** Return the list of CA domains permitted to issue for this name via CAA. */
async function checkCaa(domain) {
  const dns = await import("node:dns/promises");
  try {
    const records = await dns.resolveCaa(domain);
    return records.map((r) => r.issue).filter(Boolean);
  } catch (err) {
    if (err.code === "ENODATA" || err.code === "ENOTFOUND") return [];
    throw err;
  }
}

/** Add a CAA record permitting caDomain to issue for domain, via Cloudflare. */
async function addCaaRecord(domain, caDomain) {
  if (DRY_RUN) {
    console.log(`[dry run] would add CAA record on ${domain} permitting ${caDomain}`);
    return;
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "CAA",
      name: domain,
      data: { flags: 0, tag: "issue", value: caDomain },
    }),
  });
  if (!res.ok) throw new Error(`Cloudflare API returned ${res.status}`);
  console.log(`Added CAA record on ${domain} permitting ${caDomain}`);
}

export async function run() {
  console.log(`Checking TLS certificate for ${DNS_DOMAIN} (DRY_RUN=${DRY_RUN})`);

  const cert = await fetchPeerCertificate(DNS_DOMAIN);
  const notAfter = new Date(cert.valid_to);
  const now = new Date();
  const days = daysUntilExpiry(notAfter, now);
  const severity = classify(days, WARN_AT_DAYS, CRIT_AT_DAYS);

  console.log(`Certificate for ${DNS_DOMAIN} expires in ${days} day(s): ${severity}`);

  if (severity === "ok") {
    console.log("OK: certificate has plenty of runway left.");
    return;
  }

  console.warn(`Certificate for ${DNS_DOMAIN} is ${severity} (${days} days remaining).`);

  const permittedCas = await checkCaa(DNS_DOMAIN);
  if (permittedCas.length > 0 && !permittedCas.some((ca) => ca.includes(CA_TO_PERMIT))) {
    console.warn(
      `CAA record on ${DNS_DOMAIN} only permits ${JSON.stringify(permittedCas)}, which blocks issuance from ${CA_TO_PERMIT}.`
    );
    if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID) {
      await addCaaRecord(DNS_DOMAIN, CA_TO_PERMIT);
    } else {
      console.warn("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to let this script add the CAA record.");
    }
  } else {
    console.warn(
      "CAA looks fine. Check the ACME client and its port 80/443 or DNS-01 automation by hand: " +
      "run 'sudo certbot renew --dry-run' on the host to see the exact failure."
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
