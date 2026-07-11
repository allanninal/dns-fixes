/**
 * Detect a TLS certificate SAN/hostname mismatch and optionally repair it via Cloudflare.
 * Safe by default. Set DRY_RUN=false to let it write.
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const CLOUDFLARE_CERT_PACK_ID = process.env.CLOUDFLARE_CERT_PACK_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Pure decision function. No I/O.
 *
 * Given the requested hostname and the list of dNSName strings pulled from
 * the certificate's SAN extension, normalize case, then return true if the
 * hostname is an exact match to any entry or matches a leftmost-label
 * wildcard entry (e.g. '*.example.com' matches 'app.example.com' but not
 * 'a.b.example.com' or the bare apex 'example.com'). Returns false otherwise.
 */
export function sanCoversHostname(hostname, sanDnsNames) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const names = sanDnsNames.map((n) => n.trim().toLowerCase().replace(/\.$/, ""));

  if (names.includes(host)) return true;

  const hostLabels = host.split(".");
  for (const name of names) {
    if (!name.startsWith("*.")) continue;
    const wildcardSuffix = name.slice(2);
    // Wildcard covers exactly one leftmost label: 'app.example.com' but not
    // 'a.b.example.com', and never the bare suffix itself ('example.com').
    if (hostLabels.length < 3) continue;
    const remainder = hostLabels.slice(1).join(".");
    if (remainder === wildcardSuffix) return true;
  }
  return false;
}

/** Open a TLS connection with SNI set to hostname and return its SAN dNSNames. Requires network. */
async function fetchSanForHostname(hostname, port = 443) {
  const tls = await import("node:tls");
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 10000 }, () => {
      const cert = socket.getPeerCertificate();
      const raw = cert.subjectaltname || "";
      const names = raw
        .split(", ")
        .filter((entry) => entry.startsWith("DNS:"))
        .map((entry) => entry.slice(4));
      socket.end();
      resolve(names);
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${hostname}:${port} timed out`));
    });
  });
}

/** Read the current hosts array off a Cloudflare Advanced Certificate pack. */
async function getCertPackHosts() {
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/ssl/certificate_packs/${CLOUDFLARE_CERT_PACK_ID}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Cloudflare cert pack read failed: ${res.status}`);
  const body = await res.json();
  return body.result.hosts || [];
}

/** Add the missing hostname as a SAN by patching the Cloudflare certificate pack. */
async function addHostnameToCertPack(hostname) {
  if (DRY_RUN) {
    console.log(`[dry run] would add ${hostname} to certificate pack ${CLOUDFLARE_CERT_PACK_ID}`);
    return;
  }

  const hosts = await getCertPackHosts();
  const nextHosts = hosts.includes(hostname) ? hosts : [...hosts, hostname];
  const url = `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/ssl/certificate_packs/${CLOUDFLARE_CERT_PACK_ID}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hosts: nextHosts }),
  });
  if (!res.ok) throw new Error(`Cloudflare cert pack update failed: ${res.status}`);
  console.log(`Requested certificate pack update to include ${hostname}`);
}

async function run() {
  const hostname = DNS_DOMAIN;
  const sanNames = await fetchSanForHostname(hostname);
  console.log(`SAN entries served for ${hostname}: ${sanNames.join(", ")}`);

  if (sanCoversHostname(hostname, sanNames)) {
    console.log(`Nothing to repair. ${hostname} is already covered.`);
    return;
  }

  console.warn(`Hostname ${hostname} is missing from the served certificate's SAN list.`);

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID && CLOUDFLARE_CERT_PACK_ID)) {
    console.warn("Mismatch found but no Cloudflare certificate pack credentials set. Skipping repair.");
    return;
  }

  await addHostnameToCertPack(hostname);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
