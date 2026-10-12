// Sign-in codes and sessions, stored in this site's own database.
//
//  - issueCode(email)          -> 6-digit code (hash kept, 10 min, 5 tries)
//  - verifyCode(email, code)   -> true once, then the code is used up
//  - createSession(email, ...) -> random token for the session cookie
//  - getSessionUser(headers)   -> who is signed in (cookie, or Bearer token)
//  - endSession(headers)       -> sign out
import {
  db,
  and,
  eq,
  gt,
  isNull,
  desc,
  authCodesTable,
  authSessionsTable,
} from "@workspace/db";

export const SESSION_COOKIE = "stockbook_session";
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_CODE_TRIES = 5;
/** Codes one address may be sent per 10 minutes. */
export const MAX_CODES_PER_WINDOW = 5;

export interface SessionUser {
  /** Stable id for the signed-in person (their lowercased email). */
  id: string;
  email: string;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uniform 6-digit code (rejection sampling avoids modulo bias). */
function randomCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** How many codes this address was sent in the last 10 minutes. */
export async function recentCodeCount(email: string): Promise<number> {
  const since = new Date(Date.now() - CODE_MINUTES * 60_000);
  const rows = await db
    .select({ id: authCodesTable.id })
    .from(authCodesTable)
    .where(and(eq(authCodesTable.email, email), gt(authCodesTable.createdAt, since)));
  return rows.length;
}

/** Creates a new code for the address (earlier unused codes stop working). */
export async function issueCode(email: string): Promise<string> {
  const code = randomCode();
  const salt = randomToken(16);
  await db
    .update(authCodesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(authCodesTable.email, email), isNull(authCodesTable.consumedAt)));
  await db.insert(authCodesTable).values({
    email,
    salt,
    codeHash: await sha256(`${salt}:${code}`),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
  });
  return code;
}

export type VerifyResult = "ok" | "invalid" | "expired" | "too_many_tries";

/** Checks the latest code for the address; a correct code can be used once. */
export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(authCodesTable)
    .where(and(eq(authCodesTable.email, email), isNull(authCodesTable.consumedAt)))
    .orderBy(desc(authCodesTable.createdAt))
    .limit(1);
  if (!row) return "expired";
  if (row.expiresAt.getTime() < Date.now()) return "expired";
  if (row.attempts >= MAX_CODE_TRIES) return "too_many_tries";

  const ok = sameString(await sha256(`${row.salt}:${code}`), row.codeHash);
  if (!ok) {
    await db
      .update(authCodesTable)
      .set({ attempts: row.attempts + 1 })
      .where(eq(authCodesTable.id, row.id));
    return row.attempts + 1 >= MAX_CODE_TRIES ? "too_many_tries" : "invalid";
  }
  // Single use: only the request that flips consumed_at wins.
  const used = await db
    .update(authCodesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(authCodesTable.id, row.id), isNull(authCodesTable.consumedAt)))
    .returning({ id: authCodesTable.id });
  return used.length ? "ok" : "expired";
}

export async function createSession(
  email: string,
  info: { userAgent?: string; ip?: string },
): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken(32);
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  await db.insert(authSessionsTable).values({
    tokenHash: await sha256(token),
    email,
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
    userAgent: info.userAgent?.slice(0, 300) ?? null,
    ip: info.ip ?? null,
  });
  return { token, maxAgeSeconds };
}

/** Session token from the cookie, or from `Authorization: Bearer` (API clients). */
export function sessionToken(headers: Record<string, string | undefined>): string | null {
  const auth = headers["authorization"];
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
  if (m) return m[1]!.trim();
  const cookie = headers["cookie"];
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { user: SessionUser | null; exp: number }>();

export async function getSessionUser(
  headers: Record<string, string | undefined>,
): Promise<SessionUser | null> {
  const token = sessionToken(headers);
  if (!token || token.length > 200) return null;
  const hash = await sha256(token);
  const now = Date.now();
  const hit = cache.get(hash);
  if (hit && hit.exp > now) return hit.user;

  const [row] = await db
    .select({ email: authSessionsTable.email, expiresAt: authSessionsTable.expiresAt })
    .from(authSessionsTable)
    .where(eq(authSessionsTable.tokenHash, hash));
  const user = row && row.expiresAt.getTime() > now ? { id: row.email, email: row.email } : null;
  if (cache.size > 1000) cache.clear();
  cache.set(hash, { user, exp: now + CACHE_MS });
  return user;
}

export async function endSession(headers: Record<string, string | undefined>): Promise<void> {
  const token = sessionToken(headers);
  if (!token) return;
  const hash = await sha256(token);
  cache.delete(hash);
  await db.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, hash));
}

/** Set-Cookie value for the session (or to clear it when token is null). */
export function sessionCookie(token: string | null, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${token ? maxAgeSeconds : 0}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
