// Verifies the caller's Supabase Auth session. The browser sends its access
// token as `Authorization: Bearer <jwt>`; we confirm it with Supabase Auth
// (so revoked/expired sessions are rejected) and cache the result briefly.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../src/lib/supabaseConfig";

export interface SessionUser {
  id: string;
  email: string | null;
}

const TTL_MS = 60 * 1000;
const cache = new Map<string, { user: SessionUser | null; exp: number }>();

function bearer(headers: Record<string, string | undefined>): string | null {
  const h = headers["authorization"];
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

export async function getSessionUser(
  headers: Record<string, string | undefined>,
): Promise<SessionUser | null> {
  const token = bearer(headers);
  if (!token) return null;

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.exp > now) return hit.user;

  let user: SessionUser | null = null;
  try {
    const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;
    const resp = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const data = (await resp.json()) as { id?: string; email?: string | null };
      if (data.id) user = { id: data.id, email: data.email?.toLowerCase() ?? null };
    }
  } catch {
    user = null;
  }

  if (cache.size > 500) cache.clear();
  cache.set(token, { user, exp: now + TTL_MS });
  return user;
}
