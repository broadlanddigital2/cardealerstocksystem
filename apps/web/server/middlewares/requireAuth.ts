import type { Request, Response, NextFunction } from "../http";
import { db, appUsersTable } from "@workspace/db";

// Single-dealer ("standalone") mode.
//
// This deployment serves ONE dealer. Every signed-in user works on the same
// shared stock book rather than a private per-user one. We still require a valid
// signed-in session (so the data is not world-readable/writable), but once a request
// is authenticated we scope all data access to a single shared tenant id instead
// of the individual signed-in user.
//
// The shared tenant id defaults to the dealer whose data this app was set up
// with ("Manor Garage Car Sales Ltd"). It can be overridden per deployment via
// the SHARED_TENANT_ID env var, so a different deployment can point at a
// different dealer's data without code changes.
export const SHARED_TENANT_ID =
  process.env.SHARED_TENANT_ID || "user_3EdZv4RPs4Xi0cpKN6IiBWJ9dyz";

// Invite-only access control.
//
// Anyone can create an account, so authentication alone does not
// restrict who can reach the shared stock book. We additionally gate access on
// an allowlist of email addresses supplied via the ALLOWED_EMAILS env var
// (comma-separated). Only signed-in users whose primary email is on the list
// may read or write data. An empty/unset allowlist denies everyone (secure
// default) — the deploy is expected to set ALLOWED_EMAILS.
//
// Emails that are ALWAYS allowed in, on every deployment and every remix for
// other dealers, regardless of the per-deployment ALLOWED_EMAILS env var. This
// is hardcoded (not env-based) on purpose so the operator can never be locked
// out of a freshly remixed site whose ALLOWED_EMAILS hasn't been set yet.
const ALWAYS_ALLOWED_EMAILS = new Set<string>([
  "chris.swinton@swintonaccountants.co.uk",
]);

// Admins that are ALWAYS treated as admins (operator), regardless of the
// per-deployment ADMIN_EMAILS env var — mirrors ALWAYS_ALLOWED_EMAILS so the
// operator can never be locked out of admin-only areas (Reports, Settings).
const ALWAYS_ADMIN_EMAILS = new Set<string>([
  "chris.swinton@swintonaccountants.co.uk",
]);

function getAllowlist(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Admin allowlist (comma-separated ADMIN_EMAILS env). Admins get access to
// everything; non-admin invited users get access to everything EXCEPT the
// admin-only areas (Reports and Settings). Admins are implicitly allowed even
// if they are not listed in ALLOWED_EMAILS.
function getAdminList(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// DB-backed access list (the Settings "Users" tab manages this). It is the
// runtime source of truth for who may sign in and at what level; the env vars
// above remain only as an additional backstop. A short in-memory cache avoids
// hitting the DB on every request; mutations call bustUserCache() so changes
// take effect immediately.
const USER_CACHE_TTL_MS = 30 * 1000;
let userCache: { map: Map<string, "admin" | "user">; ts: number } | null = null;

async function getDbUsers(): Promise<Map<string, "admin" | "user">> {
  const now = Date.now();
  if (userCache && now - userCache.ts < USER_CACHE_TTL_MS) return userCache.map;
  try {
    const rows = await db.select().from(appUsersTable);
    const map = new Map<string, "admin" | "user">();
    for (const row of rows) {
      map.set(row.email.toLowerCase(), row.role === "admin" ? "admin" : "user");
    }
    userCache = { map, ts: now };
    return map;
  } catch {
    // On a transient DB error keep serving the last known list rather than
    // locking everyone out; if we have nothing cached, deny (empty map).
    if (userCache) return userCache.map;
    return new Map();
  }
}

// Invalidate the cached user list so the next access check re-reads the DB.
// Called by the users route after any create/update/delete.
export function bustUserCache(): void {
  userCache = null;
}

export async function isEmailAdmin(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase();
  if (ALWAYS_ADMIN_EMAILS.has(normalized) || getAdminList().has(normalized)) {
    return true;
  }
  const users = await getDbUsers();
  return users.get(normalized) === "admin";
}

export async function isEmailAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase();
  if (ALWAYS_ALLOWED_EMAILS.has(normalized) || getAllowlist().has(normalized)) {
    return true;
  }
  if (await isEmailAdmin(normalized)) return true;
  const users = await getDbUsers();
  return users.has(normalized);
}

// The real signed-in user (from the session cookie), resolved once per request by the API
// entry point (server/index.ts) and stored on the request. This is distinct
// from SHARED_TENANT_ID, which is only the data scope.
export function getSessionUserId(req: Request): string | null {
  return req.sessionUserId ? String(req.sessionUserId) : null;
}

// Emails of users verified during this isolate's recent requests, keyed by
// user id (filled by server/index.ts from the verified session).
const sessionEmails = new Map<string, string | null>();

export function rememberSessionEmail(userId: string, email: string | null): void {
  if (sessionEmails.size > 1000) sessionEmails.clear();
  sessionEmails.set(userId, email);
}

export async function getUserEmail(userId: string): Promise<string | null> {
  return sessionEmails.get(userId) ?? null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionUserId = getSessionUserId(req);
  if (!sessionUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const email = await getUserEmail(sessionUserId);
  if (!(await isEmailAllowed(email))) {
    // Signed in, but not invited to this dealer's stock book.
    res.status(403).json({ error: "not_invited", email });
    return;
  }

  // Authenticated and invited — scope data to the single shared dealer, not this
  // individual signed-in user. See SHARED_TENANT_ID above.
  req.userId = SHARED_TENANT_ID;
  next();
}

// Like requireAuth, but additionally requires the signed-in user to be an admin.
// Used for admin-only areas (Reports and Settings). Non-admin invited users get
// a 403 "forbidden".
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionUserId = getSessionUserId(req);
  if (!sessionUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const email = await getUserEmail(sessionUserId);
  if (!(await isEmailAllowed(email))) {
    res.status(403).json({ error: "not_invited", email });
    return;
  }
  if (!(await isEmailAdmin(email))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  req.userId = SHARED_TENANT_ID;
  next();
}
