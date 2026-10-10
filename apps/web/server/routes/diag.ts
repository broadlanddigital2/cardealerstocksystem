import { Router } from "../http";
import { db } from "@workspace/db";

// GET /_diag?debug=<CRON_SECRET> — operator-only health report: which config is
// present (never values) and whether Supabase answers within 8 seconds.
const router = new Router();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

router.get("/_diag", async (req, res): Promise<void> => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.debug !== secret) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const present = (k: string) => Boolean(process.env[k]);
  const started = Date.now();
  let database: unknown;
  try {
    await withTimeout(db.ping(), 8000);
    database = { ok: true, ms: Date.now() - started };
  } catch (err) {
    database = {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
  res.json({
    env: {
      SUPABASE_URL: present("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
      SENDGRID_API_KEY: present("SENDGRID_API_KEY"),
      CRON_SECRET: true,
    },
    database,
  });
});

export default router;
