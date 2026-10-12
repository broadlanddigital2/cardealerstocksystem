import { Router } from "../http";
import { isEmailAllowed } from "../middlewares/requireAuth";
import { sendSignInCode } from "../lib/email";
import {
  MAX_CODES_PER_WINDOW,
  createSession,
  endSession,
  getSessionUser,
  issueCode,
  recentCodeCount,
  sessionCookie,
  verifyCode,
} from "../lib/session";

// Sign-in with an emailed 6-digit code, handled entirely by this site:
//
//   POST /auth/send-code   { email }        emails a code (invited addresses only)
//   POST /auth/verify-code { email, code }  sets the session cookie
//   GET  /auth/session                      who is signed in
//   POST /auth/sign-out                     ends the session
//
// send-code answers the same way whether or not the address is invited, so it
// can't be used to find out who has access.
const router = new Router();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 10;
const ipAttempts = new Map<string, { count: number; start: number }>();

function ipLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (ipAttempts.size > 5000) ipAttempts.clear();
    ipAttempts.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_IP;
}

function readEmail(body: unknown): string | null {
  const email = String((body as { email?: unknown } | null)?.email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

router.post("/auth/send-code", async (req, res): Promise<void> => {
  const email = readEmail(req.body);
  if (!email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (ipLimited(`send:${req.ip ?? "unknown"}`)) {
    res.status(429).json({ error: "Too many code requests. Please wait a few minutes and try again." });
    return;
  }

  if (await isEmailAllowed(email)) {
    if ((await recentCodeCount(email)) >= MAX_CODES_PER_WINDOW) {
      res.status(429).json({ error: "Too many code requests. Please wait a few minutes and try again." });
      return;
    }
    const code = await issueCode(email);
    try {
      await sendSignInCode({ to: email, code });
    } catch (err) {
      req.log.error({ err }, "Sign-in code email failed");
      res.status(502).json({ error: "We couldn't send a code just now. Please try again shortly." });
      return;
    }
  } else {
    req.log.info({ email }, "Sign-in code requested for an email that isn't invited");
  }
  res.json({ ok: true });
});

router.post("/auth/verify-code", async (req, res): Promise<void> => {
  const email = readEmail(req.body);
  const code = String((req.body as { code?: unknown } | null)?.code ?? "").replace(/\s+/g, "");
  if (!email || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Enter the 6-digit code from the email." });
    return;
  }
  if (ipLimited(`verify:${req.ip ?? "unknown"}`)) {
    res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }
  if (!(await isEmailAllowed(email))) {
    res.status(400).json({ error: "That code is wrong or has expired. Request a new one." });
    return;
  }

  const result = await verifyCode(email, code);
  if (result !== "ok") {
    const message =
      result === "too_many_tries"
        ? "Too many wrong codes. Request a new one."
        : result === "expired"
          ? "That code has expired. Request a new one."
          : "That code isn't right. Check the email and try again.";
    res.status(400).json({ error: message, reason: result });
    return;
  }

  const { token, maxAgeSeconds } = await createSession(email, {
    userAgent: req.get("user-agent"),
    ip: req.ip,
  });
  res.setHeader("Set-Cookie", sessionCookie(token, maxAgeSeconds, req.protocol === "https"));
  res.json({ ok: true, email });
});

router.get("/auth/session", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.headers);
  if (!user) {
    res.status(401).json({ signedIn: false });
    return;
  }
  res.json({ signedIn: true, email: user.email });
});

router.post("/auth/sign-out", async (req, res): Promise<void> => {
  await endSession(req.headers);
  res.setHeader("Set-Cookie", sessionCookie(null, 0, req.protocol === "https"));
  res.json({ ok: true });
});

export default router;
