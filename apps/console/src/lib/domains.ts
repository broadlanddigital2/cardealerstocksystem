// Dealers' own web addresses, using Cloudflare for SaaS ("custom hostnames")
// on the platform zone. For each address the console:
//   1. registers it as a custom hostname (Cloudflare issues the certificate once
//      the dealer's DNS points at us),
//   2. adds a Worker route so it reaches the dealer's own site,
//   3. for showroom addresses, tells the dealer's site to serve only the public
//      showroom there (Worker secret SHOWROOM_HOSTS).
// The dealer adds one CNAME at their DNS provider: <their address> -> customers.<platform domain>.
import { and, eq } from "drizzle-orm";
import { auditLogTable, dealerDomainsTable, getDb, type Dealer, type DealerDomain } from "@/db/client";

const PLATFORM_DOMAIN = () => process.env.PLATFORM_DOMAIN || "racecargraphics.uk";
export const cnameTarget = () => `customers.${PLATFORM_DOMAIN()}`;

interface CfResult<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

async function cf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("The console can't manage domains yet (CLOUDFLARE_API_TOKEN isn't set).");
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => null)) as CfResult<T> | null;
  if (!resp.ok || !data?.success) {
    const msg = data?.errors?.map((e) => `${e.message} (${e.code})`).join("; ") || `HTTP ${resp.status}`;
    throw new Error(`Cloudflare: ${msg}`);
  }
  return data.result;
}

let zoneIdCache: string | null = null;
async function zoneId(): Promise<string> {
  if (zoneIdCache) return zoneIdCache;
  const zones = await cf<{ id: string }[]>("GET", `/zones?name=${encodeURIComponent(PLATFORM_DOMAIN())}`);
  if (!zones[0]) throw new Error(`Cloudflare zone ${PLATFORM_DOMAIN()} not found for this token.`);
  zoneIdCache = zones[0].id;
  return zoneIdCache;
}

/** One-time: the fallback origin custom hostnames resolve through. */
async function ensureFallbackOrigin(zone: string): Promise<void> {
  const origin = cnameTarget();
  const current = await cf<{ origin?: string; status?: string }>("GET", `/zones/${zone}/custom_hostnames/fallback_origin`).catch(() => null);
  if (current?.origin === origin) return;
  const existing = await cf<{ id: string }[]>("GET", `/zones/${zone}/dns_records?name=${encodeURIComponent(origin)}`);
  if (!existing.length) {
    // Requests never reach this address: the Worker route answers first.
    await cf("POST", `/zones/${zone}/dns_records`, { type: "AAAA", name: origin, content: "100::", proxied: true, comment: "Stock Book custom hostnames fallback origin" });
  }
  await cf("PUT", `/zones/${zone}/custom_hostnames/fallback_origin`, { origin });
}

async function routesFor(zone: string, hostname: string): Promise<{ id: string; pattern: string }[]> {
  const routes = await cf<{ id: string; pattern: string }[]>("GET", `/zones/${zone}/workers/routes`);
  return routes.filter((r) => r.pattern === `${hostname}/*`);
}

export function normaliseHostname(value: unknown): string | null {
  const h = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h) || h.length > 253) return null;
  if (h.endsWith(`.${PLATFORM_DOMAIN()}`) || h === PLATFORM_DOMAIN()) return null;
  return h;
}

export async function listDomains(dealerId: number): Promise<DealerDomain[]> {
  return getDb().select().from(dealerDomainsTable).where(eq(dealerDomainsTable.dealerId, dealerId)).orderBy(dealerDomainsTable.id);
}

/** Tells the dealer's site which of its addresses are showroom-only. */
async function syncShowroomHosts(dealer: Dealer): Promise<void> {
  if (!dealer.workerName) return;
  const showroom = (await listDomains(dealer.id)).filter((d) => d.kind === "showroom").map((d) => d.hostname);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) throw new Error("CLOUDFLARE_ACCOUNT_ID isn't set.");
  await cf("PUT", `/accounts/${account}/workers/scripts/${dealer.workerName}/secrets`, {
    name: "SHOWROOM_HOSTS",
    text: showroom.join(","),
    type: "secret_text",
  });
}

interface CustomHostname {
  id: string;
  status: string;
  ssl?: { status?: string; validation_records?: { txt_name?: string; txt_value?: string; http_url?: string }[]; validation_errors?: { message: string }[] };
  ownership_verification?: { type: string; name: string; value: string };
  verification_errors?: string[];
}

function recordsFor(hostname: string, ch: CustomHostname | null) {
  const records = [{ type: "CNAME", name: hostname, value: cnameTarget() }];
  if (ch?.ownership_verification && ch.status !== "active") {
    records.push({ type: ch.ownership_verification.type.toUpperCase(), name: ch.ownership_verification.name, value: ch.ownership_verification.value });
  }
  for (const r of ch?.ssl?.validation_records ?? []) {
    if (r.txt_name && r.txt_value && ch?.ssl?.status !== "active") records.push({ type: "TXT", name: r.txt_name, value: r.txt_value });
  }
  return records;
}

export async function addDomain(dealer: Dealer, hostnameRaw: unknown, kindRaw: unknown, actor: string): Promise<void> {
  const hostname = normaliseHostname(hostnameRaw);
  if (!hostname) throw new Error("Enter an address like stock.example.co.uk (not one on the platform domain).");
  const kind = kindRaw === "showroom" ? "showroom" : "staff";
  if (dealer.status !== "active" || !dealer.workerName) throw new Error("Set the dealer up before adding their own address.");
  const db = getDb();
  const [taken] = await db.select({ id: dealerDomainsTable.id }).from(dealerDomainsTable).where(eq(dealerDomainsTable.hostname, hostname));
  if (taken) throw new Error(`${hostname} is already added.`);

  const zone = await zoneId();
  await ensureFallbackOrigin(zone);
  const ch = await cf<CustomHostname>("POST", `/zones/${zone}/custom_hostnames`, {
    hostname,
    ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
  });
  let routeId: string | null = null;
  try {
    const existing = (await routesFor(zone, hostname))[0];
    routeId = existing
      ? existing.id
      : (await cf<{ id: string }>("POST", `/zones/${zone}/workers/routes`, { pattern: `${hostname}/*`, script: dealer.workerName })).id;
  } catch (err) {
    await cf("DELETE", `/zones/${zone}/custom_hostnames/${ch.id}`).catch(() => {});
    throw err;
  }
  await db.insert(dealerDomainsTable).values({
    dealerId: dealer.id,
    hostname,
    kind,
    cfHostnameId: ch.id,
    cfRouteId: routeId,
    status: ch.status === "active" && ch.ssl?.status === "active" ? "active" : "pending",
    sslStatus: ch.ssl?.status ?? null,
    records: recordsFor(hostname, ch),
    checkedAt: new Date(),
  });
  if (kind === "showroom") await syncShowroomHosts(dealer);
  await db.insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "domain.added", detail: { hostname, kind } });
}

/** Re-reads a domain's status from Cloudflare. */
export async function checkDomain(domain: DealerDomain): Promise<DealerDomain> {
  if (!domain.cfHostnameId) return domain;
  const zone = await zoneId();
  const db = getDb();
  try {
    const ch = await cf<CustomHostname>("GET", `/zones/${zone}/custom_hostnames/${domain.cfHostnameId}`);
    const active = ch.status === "active" && ch.ssl?.status === "active";
    const problems = [...(ch.verification_errors ?? []), ...(ch.ssl?.validation_errors?.map((e) => e.message) ?? [])];
    const [row] = await db
      .update(dealerDomainsTable)
      .set({
        status: active ? "active" : "pending",
        sslStatus: ch.ssl?.status ?? null,
        records: recordsFor(domain.hostname, ch),
        message: active ? null : problems.join("; ") || null,
        checkedAt: new Date(),
      })
      .where(eq(dealerDomainsTable.id, domain.id))
      .returning();
    return row!;
  } catch (err) {
    const [row] = await db
      .update(dealerDomainsTable)
      .set({ status: "error", message: err instanceof Error ? err.message : String(err), checkedAt: new Date() })
      .where(eq(dealerDomainsTable.id, domain.id))
      .returning();
    return row!;
  }
}

export async function removeDomain(dealer: Dealer, domainId: number, actor: string): Promise<void> {
  const db = getDb();
  const [domain] = await db
    .select()
    .from(dealerDomainsTable)
    .where(and(eq(dealerDomainsTable.id, domainId), eq(dealerDomainsTable.dealerId, dealer.id)));
  if (!domain) return;
  const zone = await zoneId();
  // Matched by address: a redeploy of the dealer's site recreates its routes with new ids.
  for (const r of await routesFor(zone, domain.hostname).catch(() => [])) {
    await cf("DELETE", `/zones/${zone}/workers/routes/${r.id}`).catch(() => {});
  }
  if (domain.cfHostnameId) await cf("DELETE", `/zones/${zone}/custom_hostnames/${domain.cfHostnameId}`).catch(() => {});
  await db.delete(dealerDomainsTable).where(eq(dealerDomainsTable.id, domain.id));
  if (domain.kind === "showroom") await syncShowroomHosts(dealer);
  await db.insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "domain.removed", detail: { hostname: domain.hostname } });
}
