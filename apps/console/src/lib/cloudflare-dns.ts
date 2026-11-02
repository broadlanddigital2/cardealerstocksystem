// Adds DNS records for a dealer automatically when their domain's DNS is
// managed in our Cloudflare account (otherwise the console shows the records
// to copy). Needs the console's Cloudflare token to have Zone -> DNS -> Edit
// on that zone (or "All zones").
//
// Records are replaced only where a domain can have just one: the MX records
// for incoming mail, the SPF record (v=spf1), a DKIM/DMARC/MTA-STS/TLS-RPT
// record of the same kind, and a CNAME at the same name. Anything else at the
// name is left alone; a clash (e.g. a website A record where a CNAME must go)
// is reported, not overwritten.
import { cf } from "@/lib/domains";

export interface WantedRecord {
  type: string;
  name: string; // "@", a label like "_dmarc", or a full name
  value: string;
  priority?: number | null;
}

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
  proxied?: boolean;
}

export interface ApplyResult {
  added: string[];
  replaced: string[];
  unchanged: string[];
  skipped: string[];
}

/** The Cloudflare zone (in our account) that holds this domain, if any. */
export async function findZone(domain: string): Promise<{ id: string; name: string } | null> {
  if (!process.env.CLOUDFLARE_API_TOKEN) return null;
  const labels = domain.toLowerCase().split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    try {
      const zones = await cf<{ id: string; name: string }[]>("GET", `/zones?name=${encodeURIComponent(name)}`);
      if (zones[0]) return { id: zones[0].id, name: zones[0].name };
    } catch {
      return null; // token can't list zones: treat as not ours
    }
  }
  return null;
}

/** Can we edit this zone's DNS? (Listing records needs the same zone access.) */
export async function canEditZone(zoneId: string): Promise<boolean> {
  try {
    await cf("GET", `/zones/${zoneId}/dns_records?per_page=1`);
    return true;
  } catch {
    return false;
  }
}

export function fqdn(name: string, domain: string): string {
  const n = name.trim().replace(/\.$/, "").toLowerCase();
  if (n === "@" || n === "" || n === domain) return domain;
  return n.endsWith(`.${domain}`) ? n : `${n}.${domain}`;
}

const TXT_KINDS = ["v=spf1", "v=dkim1", "v=dmarc1", "v=stsv1", "v=tlsrptv1"];
function txtKind(value: string): string | null {
  const v = value.replace(/^"|"$/g, "").trim().toLowerCase();
  return TXT_KINDS.find((k) => v.startsWith(k)) ?? null;
}
const sameValue = (a: string, b: string) =>
  a.replace(/^"|"$/g, "").replace(/\.$/, "").trim().toLowerCase() === b.replace(/^"|"$/g, "").replace(/\.$/, "").trim().toLowerCase();

/** Adds the records to the zone, replacing only the ones that must be unique. */
export async function applyRecords(zoneId: string, domain: string, wanted: WantedRecord[]): Promise<ApplyResult> {
  const result: ApplyResult = { added: [], replaced: [], unchanged: [], skipped: [] };
  const mxDone = new Set<string>();
  for (const w of wanted) {
    const type = w.type.toUpperCase();
    const name = fqdn(w.name, domain);
    const value = w.value.replace(/\.$/, "");
    const label = `${type} ${name}`;
    const existing = await cf<CfRecord[]>("GET", `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`);

    const create = () =>
      cf("POST", `/zones/${zoneId}/dns_records`, {
        type,
        name,
        content: value,
        ttl: 1,
        ...(type === "MX" ? { priority: w.priority ?? 10 } : {}),
        // Mail and verification records must not go through Cloudflare's proxy.
        ...(type === "CNAME" ? { proxied: false } : {}),
        comment: "Added by the Stock Book console",
      });

    if (type === "MX") {
      const mx = existing.filter((r) => r.type === "MX");
      if (mx.some((r) => sameValue(r.content, value))) {
        result.unchanged.push(label);
        continue;
      }
      // The domain's incoming mail moves to the new host: old MX records go (once per name).
      if (!mxDone.has(name)) {
        for (const r of mx) await cf("DELETE", `/zones/${zoneId}/dns_records/${r.id}`);
        mxDone.add(name);
      }
      await create();
      (mx.length ? result.replaced : result.added).push(label);
      continue;
    }

    if (type === "TXT") {
      const kind = txtKind(value);
      const txt = existing.filter((r) => r.type === "TXT");
      if (txt.some((r) => sameValue(r.content, value))) {
        result.unchanged.push(label);
        continue;
      }
      const same = kind ? txt.filter((r) => txtKind(r.content) === kind) : [];
      for (const r of same) await cf("DELETE", `/zones/${zoneId}/dns_records/${r.id}`);
      await create();
      (same.length ? result.replaced : result.added).push(label);
      continue;
    }

    if (type === "CNAME") {
      const cname = existing.find((r) => r.type === "CNAME");
      if (cname && sameValue(cname.content, value)) {
        result.unchanged.push(label);
        continue;
      }
      const clash = existing.filter((r) => r.type !== "CNAME");
      if (clash.length) {
        result.skipped.push(`${label}: ${clash.map((r) => r.type).join("/")} record already there (left alone)`);
        continue;
      }
      if (cname) await cf("DELETE", `/zones/${zoneId}/dns_records/${cname.id}`);
      await create();
      (cname ? result.replaced : result.added).push(label);
      continue;
    }

    if (existing.some((r) => r.type === type && sameValue(r.content, value))) result.unchanged.push(label);
    else {
      await create();
      result.added.push(label);
    }
  }
  return result;
}

export function describeResult(r: ApplyResult): string {
  const parts = [
    r.added.length && `${r.added.length} added`,
    r.replaced.length && `${r.replaced.length} replaced`,
    r.unchanged.length && `${r.unchanged.length} already right`,
  ].filter(Boolean);
  const skipped = r.skipped.length ? ` Not changed: ${r.skipped.join("; ")}.` : "";
  return `Cloudflare DNS: ${parts.join(", ") || "nothing to do"}.${skipped}`;
}
