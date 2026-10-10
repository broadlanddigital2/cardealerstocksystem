import { Router } from "../http";
import { sql } from "drizzle-orm";
import { db, pgDriver } from "@workspace/db";

// GET /_diag?debug=<CRON_SECRET> — operator-only health report: which config is
// present (never values) and whether the database answers within 8 seconds.
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
  let dbHost: string | null = null;
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    dbHost = `${u.hostname}:${u.port || "5432"} as ${decodeURIComponent(u.username)}`;
  } catch {
    dbHost = null;
  }
  const started = Date.now();
  let database: unknown;
  try {
    const r = await withTimeout(db.execute(sql`select now() as now, current_user as user`), 8000);
    database = { ok: true, ms: Date.now() - started, rows: (r as { rows?: unknown[] }).rows ?? r };
  } catch (err) {
    database = {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      cause: err instanceof Error && err.cause ? String(err.cause) : undefined,
      causeStack: err instanceof Error && err.cause instanceof Error ? err.cause.stack?.split("\n").slice(0, 12) : undefined,
    };
  }
  const driver: Record<string, unknown> = {
    typeofPool: typeof (pgDriver as unknown as { Pool?: unknown }).Pool,
    typeofClient: typeof (pgDriver as unknown as { Client?: unknown }).Client,
    userAgent: typeof navigator !== "undefined" ? (navigator as { userAgent?: string }).userAgent : null,
  };
  try {
    const c = new (pgDriver as unknown as { Client: new (o: unknown) => { connect(): Promise<void>; end(): Promise<void> } }).Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    await withTimeout(c.connect(), 9000);
    await c.end();
    driver.rawClient = "connected";
  } catch (err) {
    driver.rawClient = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    driver.rawClientStack = err instanceof Error ? err.stack?.split("\n").slice(0, 12) : undefined;
  }
  res.json({
    env: {
      DATABASE_URL: present("DATABASE_URL"),
      dbTarget: dbHost,
      DB_SCOPE: process.env.DB_SCOPE ?? null,
      SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
      SENDGRID_API_KEY: present("SENDGRID_API_KEY"),
      CRON_SECRET: true,
    },
    database,
    driver,
  });
});

export default router;
