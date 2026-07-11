/**
 * Detect a DNS record a reconciler is about to write without proof of
 * ownership, and repair it via Cloudflare only when the ownership marker
 * matches. Safe to run on a schedule. Stays in dry run until DRY_RUN=false.
 *
 * Guide: https://www.allanninal.dev/dns/unowned-record-overwritten/
 */
import { pathToFileURL } from "node:url";

const DNS_DOMAIN = process.env.DNS_DOMAIN || "example.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const DNS_OWNER_ID = process.env.DNS_OWNER_ID || "team-a";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * intended: { name: string, type: string, content: string, owner: string }
 * live: { name: string, type: string, content: string, comment: string|null } or null if absent
 * ownerId: this reconciler's own owner tag, e.g. "team-a"
 * Returns one of: "create", "update", "skip_conflict", "noop"
 * Pure decision logic, no I/O: given the intended record, the current live record
 * (or null), and this instance's owner id, decide whether it is safe to write.
 */
export function decideAction(intended, live, ownerId) {
  if (live === null || live === undefined) {
    return "create";
  }

  const liveComment = live.comment || "";
  const liveOwner = liveComment.includes("managed-by:")
    ? liveComment.split("managed-by:").pop().trim()
    : null;

  if (liveOwner === null) {
    return "skip_conflict";
  }
  if (liveOwner !== ownerId) {
    return "skip_conflict";
  }
  if (live.content === intended.content) {
    return "noop";
  }
  return "update";
}

export async function run() {
  const zoneId = CLOUDFLARE_ZONE_ID;
  const apiToken = CLOUDFLARE_API_TOKEN;
  const ownerId = DNS_OWNER_ID;
  const dryRun = DRY_RUN;
  const domain = DNS_DOMAIN;

  // In a real run, "desired" would come from Terraform state or a
  // Kubernetes Ingress spec. Here it is one example record derived from
  // DNS_DOMAIN, so the script has something concrete to reconcile.
  const desired = [
    { name: `app.${domain}`, type: "A", content: "203.0.113.10", owner: ownerId },
  ];

  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;

  for (const intended of desired) {
    const listUrl = `${base}?name=${encodeURIComponent(intended.name)}&type=${intended.type}`;
    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) throw new Error(`Cloudflare list failed: ${listRes.status}`);
    const listBody = await listRes.json();
    const results = listBody.result || [];
    const live = results.length > 0 ? results[0] : null;

    const action = decideAction(intended, live, ownerId);
    console.log(`Record ${intended.name} (${intended.type}): action=${action}`);

    if (action === "noop") {
      console.log("Already correct and owned. Nothing to do.");
      continue;
    }

    if (action === "skip_conflict") {
      console.warn(
        `Skipping ${intended.name}: live record has no matching owner marker for '${ownerId}'. ` +
        `Refusing to overwrite a record this reconciler does not own.`
      );
      continue;
    }

    const comment = `managed-by:${ownerId}`;
    if (action === "create") {
      console.log(`${dryRun ? "Would" : "Will"} create ${intended.name} -> ${intended.content}`);
      if (!dryRun) {
        const res = await fetch(base, {
          method: "POST",
          headers,
          body: JSON.stringify({ type: intended.type, name: intended.name, content: intended.content, ttl: 300, comment }),
        });
        if (!res.ok) throw new Error(`Cloudflare create failed: ${res.status}`);
      }
    } else if (action === "update") {
      console.log(`${dryRun ? "Would" : "Will"} update ${intended.name} -> ${intended.content}`);
      if (!dryRun) {
        const res = await fetch(`${base}/${live.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ content: intended.content, comment }),
        });
        if (!res.ok) throw new Error(`Cloudflare update failed: ${res.status}`);
      }
    }
  }

  console.log("Done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
