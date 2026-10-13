// Console sign-in: emailed 6-digit code, then an HttpOnly session cookie.
// Only addresses listed in CONSOLE_ADMIN_EMAILS can get a code or a session.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { consoleAuthCodesTable, consoleSessionsTable, getDb } from "@/db/client";
import { sendEmail } from "./email";

const COOKIE = "console_session";
const SESSION_DAYS = 7;
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const MAX_CODES_PER_WINDOW = 5;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (v: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(v)));

function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function adminEmails(): Set<string> {
  return new Set(
    (process.env.CONSOLE_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function normaliseEmail(value: unknown): string | null {
  const e = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Emails a code if the address is a console admin. Always resolves the same way. */
export async function requestCode(email: string): Promise<void> {
  if (!adminEmails().has(email)) return;
  const db = getDb();
  const since = new Date(Date.now() - CODE_MINUTES * 60_000);
  const recent = await db
    .select({ id: consoleAuthCodesTable.id })
    .from(consoleAuthCodesTable)
    .where(and(eq(consoleAuthCodesTable.email, email), gt(consoleAuthCodesTable.createdAt, since)));
  if (recent.length >= MAX_CODES_PER_WINDOW) throw new Error("Too many codes requested. Wait a few minutes.");

  const code = randomCode();
  const salt = randomToken(16);
  await db
    .update(consoleAuthCodesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(consoleAuthCodesTable.email, email), isNull(consoleAuthCodesTable.consumedAt)));
  await db.insert(consoleAuthCodesTable).values({
    email,
    salt,
    codeHash: await sha256(`${salt}:${code}`),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
  });
  await sendEmail(
    email,
    `Console sign-in code: ${code}`,
    `Your Stock Book console sign-in code is ${code}. It expires in 10 minutes.`,
    `<p>Your Stock Book console sign-in code is</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;font-family:monospace">${code}</p><p style="color:#666;font-size:13px">It expires in 10 minutes and can only be used once.</p>`,
  );
}

/** Checks the code; on success sets the session cookie. Returns an error message or null. */
export async function verifyCode(email: string, code: string): Promise<string | null> {
  if (!adminEmails().has(email) || !/^\d{6}$/.test(code)) return "That code isn't right.";
  const db = getDb();
  const [row] = await db
    .select()
    .from(consoleAuthCodesTable)
    .where(and(eq(consoleAuthCodesTable.email, email), isNull(consoleAuthCodesTable.consumedAt)))
    .orderBy(desc(consoleAuthCodesTable.createdAt))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return "That code has expired. Request a new one.";
  if (row.attempts >= MAX_TRIES) return "Too many wrong codes. Request a new one.";
  if (!same(await sha256(`${row.salt}:${code}`), row.codeHash)) {
    await db
      .update(consoleAuthCodesTable)
      .set({ attempts: row.attempts + 1 })
      .where(eq(consoleAuthCodesTable.id, row.id));
    return "That code isn't right.";
  }
  const used = await db
    .update(consoleAuthCodesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(consoleAuthCodesTable.id, row.id), isNull(consoleAuthCodesTable.consumedAt)))
    .returning({ id: consoleAuthCodesTable.id });
  if (!used.length) return "That code has expired. Request a new one.";

  const token = randomToken();
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db.insert(consoleSessionsTable).values({
    tokenHash: await sha256(token),
    email,
    expiresAt: new Date(Date.now() + maxAge * 1000),
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return null;
}

/** The signed-in console admin's email, or null. */
export async function currentAdmin(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const [row] = await getDb()
    .select({ email: consoleSessionsTable.email, expiresAt: consoleSessionsTable.expiresAt })
    .from(consoleSessionsTable)
    .where(eq(consoleSessionsTable.tokenHash, await sha256(token)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  // Removing someone from CONSOLE_ADMIN_EMAILS ends their access immediately.
  return adminEmails().has(row.email) ? row.email : null;
}

/** For pages and actions: the admin's email, or a redirect to sign-in. */
export async function requireAdmin(): Promise<string> {
  const email = await currentAdmin();
  if (!email) redirect("/sign-in");
  return email;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await getDb().delete(consoleSessionsTable).where(eq(consoleSessionsTable.tokenHash, await sha256(token)));
  }
  jar.delete(COOKIE);
}
