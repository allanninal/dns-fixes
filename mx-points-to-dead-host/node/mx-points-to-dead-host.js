/**
 * Detect an MX record that points at a host with no working SMTP
 * listener on port 25 (dangling hostname, refused connection, or
 * timeout), and optionally repair the zone via Cloudflare by
 * repointing the record at a known-good mail host.
 *
 * Safe by default. Set DRY_RUN=false to let it write.
 *
 * Env vars:
 *   DNS_DOMAIN               the domain to check, e.g. "example.com"
 *   CLOUDFLARE_API_TOKEN     Cloudflare API token (only needed for repair)
 *   CLOUDFLARE_ZONE_ID       Cloudflare zone id (only needed for repair)
 *   DRY_RUN                  default "true"; set to "false" to actually write
 *   KNOWN_GOOD_MX_HOST       hostname to repoint to when all MX hosts are down
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const KNOWN_GOOD_MX_HOST = process.env.KNOWN_GOOD_MX_HOST || "";

const CF_API = "https://api.cloudflare.com/client/v4";
const SMTP_PORT = 25;
const SOCKET_TIMEOUT_MS = 5000;

export function classifyMxHealth(mxRecords, resolvedIps, port25Results) {
  // Pure decision function. No I/O.
  //
  // mxRecords: array of [priority, hostname] pairs.
  // resolvedIps: object mapping hostname -> array of ip strings; an
  //   empty array means NXDOMAIN or no A/AAAA record (dangling host).
  // port25Results: object mapping hostname -> one of "connected",
  //   "refused", "timeout", or "no_dns".
  //
  // Returns an object with one entry per hostname, "healthy",
  // "dangling", or "unreachable", plus an "all_down" boolean that is
  // true only when every hostname's status is not "connected".
  const status = {};
  for (const [, hostname] of mxRecords) {
    const ips = resolvedIps[hostname] || [];
    const result = port25Results[hostname] || "no_dns";
    if (ips.length === 0 || result === "no_dns") {
      status[hostname] = "dangling";
    } else if (result === "connected") {
      status[hostname] = "healthy";
    } else {
      status[hostname] = "unreachable";
    }
  }

  const hostnames = Object.keys(status);
  const allDown = hostnames.length === 0 || hostnames.every((h) => status[h] !== "healthy");
  return { ...status, all_down: allDown };
}

async function fetchMxRecords(domain) {
  const dns = await import("node:dns/promises");
  const records = await dns.resolveMx(domain);
  records.sort((a, b) => a.priority - b.priority);
  return records.map((r) => [r.priority, r.exchange.replace(/\.$/, "")]);
}

async function resolveHost(hostname) {
  const dns = await import("node:dns/promises");
  const ips = [];
  for (const method of ["resolve4", "resolve6"]) {
    try {
      const addrs = await dns[method](hostname);
      ips.push(...addrs);
    } catch {
      continue;
    }
  }
  return ips;
}

function probePort25(ip) {
  return new Promise(async (resolve) => {
    if (!ip) {
      resolve("no_dns");
      return;
    }
    const net = await import("node:net");
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.once("timeout", () => finish("timeout"));
    socket.once("error", (err) => finish(err.code === "ECONNREFUSED" ? "refused" : "refused"));
    socket.once("data", (chunk) => finish(chunk.toString("utf8").startsWith("220") ? "connected" : "refused"));
    socket.connect(SMTP_PORT, ip);
  });
}

async function listMxZoneRecords(domain) {
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const params = new URLSearchParams({ type: "MX", name: domain, per_page: "100" });
  const res = await fetch(
    `${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Cloudflare list returned ${res.status}`);
  const body = await res.json();
  return body.result;
}

async function repointMxRecord(recordId, domain, newContent, priority) {
  const headers = {
    Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (DRY_RUN) {
    console.log(`[dry run] would repoint record ${recordId} to ${newContent} (priority ${priority})`);
    return;
  }
  const res = await fetch(`${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ type: "MX", name: domain, content: newContent, priority, ttl: 3600 }),
  });
  if (!res.ok) throw new Error(`Cloudflare patch returned ${res.status}`);
  console.log(`Repointed record ${recordId} to ${newContent} (priority ${priority})`);
}

async function run() {
  const records = await fetchMxRecords(DNS_DOMAIN);
  if (records.length === 0) {
    console.log(`No MX records found for ${DNS_DOMAIN}.`);
    return;
  }

  const resolvedIps = {};
  const port25Results = {};
  for (const [, hostname] of records) {
    const ips = await resolveHost(hostname);
    resolvedIps[hostname] = ips;
    port25Results[hostname] = await probePort25(ips[0]);
  }

  const health = classifyMxHealth(records, resolvedIps, port25Results);
  for (const [, hostname] of records) {
    console.log(`MX host ${hostname}: ${health[hostname]}`);
  }

  if (!health.all_down) {
    console.log(`At least one MX host for ${DNS_DOMAIN} is healthy. No repair needed.`);
    return;
  }

  console.warn(`All MX hosts for ${DNS_DOMAIN} are down. Mail delivery is fully broken.`);

  if (!KNOWN_GOOD_MX_HOST) {
    console.warn("No known-good replacement host provided. Not repairing, only reporting.");
    return;
  }

  if (!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID)) {
    console.warn("No Cloudflare credentials set. Not repairing, only reporting.");
    return;
  }

  const zoneRecords = await listMxZoneRecords(DNS_DOMAIN);
  for (const rec of zoneRecords) {
    await repointMxRecord(rec.id, DNS_DOMAIN, KNOWN_GOOD_MX_HOST, rec.priority);
  }
  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
