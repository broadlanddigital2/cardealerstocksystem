// Dealers' email: domains and mailboxes hosted by TrekMail, managed from the
// console. Mailboxes are read live from TrekMail (not copied here), so staff
// addresses live in one place. Every change is written to the audit log.
//
// Env: TREKMAIL_API_TOKEN (an "ops" token, tm_live_..., from TrekMail ->
// AI Agents & API -> Tokens).
import { eq } from "drizzle-orm";
import { auditLogTable, dealersTable, getDb, type Dealer } from "@/db/client";

const BASE = "https://trekmail.net/api/v1";

export class TrekMailError extends Error {}

export function trekmailConfigured(): boolean {
  return Boolean(process.env.TREKMAIL_API_TOKEN);
}

async function tm<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const token = process.env.TREKMAIL_API_TOKEN;
  if (!token) throw new TrekMailError("Email isn't connected yet (TREKMAIL_API_TOKEN isn't set).");
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      // State-changing calls must carry one; a fresh key per call is right here.
      ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await resp.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!resp.ok) {
    const err = (data.error ?? {}) as { message?: string; hint?: string; code?: string };
    const msg = [err.message, err.hint].filter(Boolean).join(" ") || `HTTP ${resp.status}`;
    throw new TrekMailError(`TrekMail: ${msg}`);
  }
  return ((data.data ?? data) as T) ?? ({} as T);
}

export interface TmDomain {
  id: number;
  domain: string;
  status: string; // pending_dns | active | suspended
  dns_health?: string; // ok | warn | fail
  last_checked_at?: string | null;
}

export interface TmDnsRecord {
  type: string;
  name: string;
  value: string;
  priority: number | null;
  purpose?: string;
}

export interface TmCheck {
  check_key: string;
  status: string; // pass | warn | fail | unknown
  details?: string;
  hint?: string | null;
}

export interface TmMailbox {
  id: number;
  email: string;
  status: string;
  display_name: string | null;
  login_suspended?: boolean;
  forwarding_enabled?: boolean;
  storage?: { used_mb: number };
}

export interface TmForwarding {
  id: number;
  local_part?: string;
  email?: string;
  address?: string;
  recipients: string[];
  is_active?: boolean;
}

const LOCAL_RE = /^[a-z0-9_][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/;

export function cleanLocalPart(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase().replace(/@.*$/, "");
  if (!v || v.length > 64 || !LOCAL_RE.test(v)) {
    throw new TrekMailError("Use letters, numbers, dots, hyphens or underscores for the part before the @ (e.g. sales or john.smith).");
  }
  return v;
}

function cleanEmail(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 255) throw new TrekMailError(`"${v}" isn't a valid email address.`);
  return v;
}

async function audit(actor: string, dealer: Dealer, action: string, detail: Record<string, unknown>) {
  await getDb().insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action, detail });
}

/** The domain a dealer's email uses: the one set up, else their web domain without "www.". */
export function emailDomainFor(dealer: Pick<Dealer, "emailDomain" | "webDomain">): string | null {
  return dealer.emailDomain ?? dealer.webDomain?.replace(/^www\./, "") ?? null;
}

/**
 * Adds the dealer's domain to TrekMail (or links it if it's already there) and
 * records it on the dealer. Safe to call again.
 */
export async function setUpEmailDomain(dealer: Dealer, actor: string, domainRaw?: unknown): Promise<TmDomain> {
  const name = String(domainRaw ?? emailDomainFor(dealer) ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new TrekMailError("Enter the dealer's domain, e.g. manorgcs.co.uk.");

  let domain = (await tm<TmDomain[]>("GET", `/domains?search=${encodeURIComponent(name)}&per_page=100`)).find(
    (d) => d.domain === name,
  );
  if (domain) {
    const other = await getDb()
      .select({ id: dealersTable.id, name: dealersTable.name })
      .from(dealersTable)
      .where(eq(dealersTable.trekmailDomainId, domain.id));
    if (other.some((o) => o.id !== dealer.id)) throw new TrekMailError(`${name} is already linked to ${other[0]!.name}.`);
  } else {
    domain = await tm<TmDomain>("POST", "/domains", { name, mail_hosting: "trekmail" });
  }
  await getDb()
    .update(dealersTable)
    .set({ emailDomain: name, trekmailDomainId: domain.id })
    .where(eq(dealersTable.id, dealer.id));
  await audit(actor, dealer, "email.domain_added", { domain: name });
  return domain;
}

export async function getEmailDomain(id: number): Promise<TmDomain> {
  return tm<TmDomain>("GET", `/domains/${id}`);
}

export async function getDnsRequirements(id: number): Promise<{ required_records: TmDnsRecord[]; checks: TmCheck[] }> {
  const r = await tm<{ required_records?: TmDnsRecord[]; checks?: TmCheck[] }>("GET", `/domains/${id}/dns-requirements`);
  return { required_records: r.required_records ?? [], checks: r.checks ?? [] };
}

export async function recheckDns(id: number): Promise<void> {
  await tm("POST", `/domains/${id}/dns-recheck`);
}

export async function listMailboxes(domainId: number): Promise<TmMailbox[]> {
  return tm<TmMailbox[]>("GET", `/mailboxes?domain_id=${domainId}&per_page=100`);
}

async function ownMailbox(dealer: Dealer, mailboxId: number): Promise<TmMailbox> {
  if (!dealer.trekmailDomainId) throw new TrekMailError("Set up this dealer's email first.");
  const box = (await listMailboxes(dealer.trekmailDomainId)).find((m) => m.id === mailboxId);
  if (!box) throw new TrekMailError("That mailbox isn't on this dealer's domain.");
  return box;
}

/** Emails the person an invitation to set up their mailbox (they choose their own password). */
export async function inviteMailbox(dealer: Dealer, actor: string, localRaw: unknown, recipientRaw: unknown): Promise<string> {
  if (!dealer.trekmailDomainId || !dealer.emailDomain) throw new TrekMailError("Set up this dealer's email first.");
  const local = cleanLocalPart(localRaw);
  const recipient = cleanEmail(recipientRaw);
  await tm("POST", "/mailboxes/invites", {
    domain_id: dealer.trekmailDomainId,
    local_part: local,
    recipient_email: recipient,
    expires_in_hours: 168,
  });
  const address = `${local}@${dealer.emailDomain}`;
  await audit(actor, dealer, "email.mailbox_invited", { address, sentTo: recipient });
  return address;
}

/** Creates a mailbox now and returns its one-time password (shown once, never stored). */
export async function createMailbox(
  dealer: Dealer,
  actor: string,
  localRaw: unknown,
  displayNameRaw: unknown,
): Promise<{ address: string; password: string }> {
  if (!dealer.trekmailDomainId || !dealer.emailDomain) throw new TrekMailError("Set up this dealer's email first.");
  const local = cleanLocalPart(localRaw);
  const displayName = String(displayNameRaw ?? "").trim().slice(0, 255);
  const r = await tm<TmMailbox & { one_time_password?: string }>("POST", "/mailboxes", {
    domain_id: dealer.trekmailDomainId,
    local_part: local,
    ...(displayName ? { display_name: displayName } : {}),
    password_mode: "generated_one_time",
    // Lets staff sign in to Outlook / phone mail apps with the mailbox password.
    client_auth_mode: "password_or_app_password",
  });
  const address = r.email || `${local}@${dealer.emailDomain}`;
  await audit(actor, dealer, "email.mailbox_created", { address });
  if (!r.one_time_password) throw new TrekMailError(`${address} was created, but TrekMail didn't return a password. Use Reset password.`);
  return { address, password: r.one_time_password };
}

/** A strong password TrekMail accepts: 16+ chars with upper, lower and digits. */
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "-_.!"];
  const all = sets.join("");
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b, i) => (i < sets.length ? sets[i]! : all)[b % (i < sets.length ? sets[i]!.length : all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint8Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Sets a new random password (shown once). Also signs the mailbox out of mail apps using app passwords. */
export async function resetMailboxPassword(dealer: Dealer, actor: string, mailboxId: number): Promise<{ address: string; password: string }> {
  const box = await ownMailbox(dealer, mailboxId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = generatePassword();
    try {
      await tm("POST", `/mailboxes/${box.id}/password`, { password });
      await audit(actor, dealer, "email.password_reset", { address: box.email });
      return { address: box.email, password };
    } catch (err) {
      lastErr = err; // e.g. a generated password that happens to be on a breach list: try another
    }
  }
  throw lastErr;
}

/** Deletes a mailbox (TrekMail keeps it under "Recently deleted" for a while). */
export async function deleteMailbox(dealer: Dealer, actor: string, mailboxId: number): Promise<string> {
  const box = await ownMailbox(dealer, mailboxId);
  const intent = await tm<{ id?: number | string; intent_id?: number | string }>("POST", `/mailboxes/${box.id}:delete-intent`);
  const intentId = intent.id ?? intent.intent_id;
  if (intentId == null) throw new TrekMailError("TrekMail didn't return a delete request to confirm.");
  await tm("POST", `/delete-intents/${intentId}:confirm`, undefined, { "X-Confirm-Delete": "true" });
  await audit(actor, dealer, "email.mailbox_deleted", { address: box.email });
  return box.email;
}

export async function listForwarding(domainId: number): Promise<TmForwarding[]> {
  const r = await tm<TmForwarding[] | { addresses?: TmForwarding[]; data?: TmForwarding[] }>(
    "GET",
    `/domains/${domainId}/forwarding-addresses`,
  );
  return Array.isArray(r) ? r : (r.addresses ?? r.data ?? []);
}

/** An address with no mailbox that passes mail on, e.g. sales@ -> two people. */
export async function addForwarding(dealer: Dealer, actor: string, localRaw: unknown, recipientsRaw: unknown): Promise<string> {
  if (!dealer.trekmailDomainId || !dealer.emailDomain) throw new TrekMailError("Set up this dealer's email first.");
  const local = cleanLocalPart(localRaw);
  const recipients = String(recipientsRaw ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(cleanEmail);
  if (!recipients.length || recipients.length > 15) throw new TrekMailError("Enter between 1 and 15 addresses to pass the mail to.");
  await tm("POST", `/domains/${dealer.trekmailDomainId}/forwarding-addresses`, { local_part: local, recipients, is_active: true });
  const address = `${local}@${dealer.emailDomain}`;
  await audit(actor, dealer, "email.forwarding_added", { address, recipients });
  return address;
}

export async function removeForwarding(dealer: Dealer, actor: string, forwardingId: number): Promise<void> {
  if (!dealer.trekmailDomainId) throw new TrekMailError("Set up this dealer's email first.");
  await tm("DELETE", `/domains/${dealer.trekmailDomainId}/forwarding-addresses/${forwardingId}`);
  await audit(actor, dealer, "email.forwarding_removed", { id: forwardingId });
}

export function forwardingAddress(f: TmForwarding, domain: string): string {
  return f.email ?? f.address ?? (f.local_part ? `${f.local_part}@${domain}` : `#${f.id}`);
}
