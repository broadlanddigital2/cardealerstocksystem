import { Router } from "../http";
import { isEmailAllowed } from "../middlewares/requireAuth";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../src/lib/supabaseConfig";

// POST /auth/send-code — emails a 6-digit sign-in code, but ONLY to invited
// addresses (app_users / operator list). The response is identical either way,
// so this can't be used to discover who is invited, and strangers can't create
// accounts. The code itself is issued and verified by Supabase Auth; the
// browser then calls supabase.auth.verifyOtp({ email, token, type: "email" }).
const router = new Router();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, { count: number; start: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (attempts.size > 5000) attempts.clear();
    attempts.set(key, { count: 1, start: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

router.post("/auth/send-code", async (req, res): Promise<void> => {
  const email = String((req.body ?? {}).email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (rateLimited(`ip:${req.ip ?? "unknown"}`) || rateLimited(`email:${email}`)) {
    res.status(429).json({ error: "Too many code requests. Please wait a few minutes and try again." });
    return;
  }

  if (await isEmailAllowed(email)) {
    const url = (process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;
    const resp = await fetch(`${url}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 300);
      req.log.error({ status: resp.status, detail }, "Supabase OTP request failed");
      const secret = process.env.CRON_SECRET;
      if (secret && req.query.debug === secret) {
        res.status(502).json({ error: "Supabase OTP request failed", status: resp.status, detail });
        return;
      }
      if (resp.status === 429) {
        res.status(429).json({ error: "Too many code requests. Please wait a minute and try again." });
        return;
      }
      res.status(502).json({ error: "We couldn't send a code just now. Please try again shortly." });
      return;
    }
  } else {
    req.log.info({ email }, "Sign-in code requested for an email that isn't invited");
  }

  res.json({ ok: true });
});

export default router;
