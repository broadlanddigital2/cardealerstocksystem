// Database access for the app: Drizzle over Neon's serverless driver.
//
// - Ordinary queries go over HTTPS (drizzle-orm/neon-http): one fetch per
//   query, no connection to keep open, which suits Cloudflare Workers where a
//   socket can't outlive the request that opened it.
// - db.transaction() opens a short-lived WebSocket connection
//   (drizzle-orm/neon-serverless), runs the callback as a real Postgres
//   transaction, and closes the connection when it ends.
//
// The connection string comes from DATABASE_URL (a Worker secret in
// production). It is read lazily, on first use, because on Workers the
// environment is only populated once a request arrives.
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

type Schema = typeof schema;

/** The query API the app uses (same builder API for HTTP and transactions). */
export type Database = NeonDatabase<Schema> & {
  /** Cheap round trip used by the health check. */
  ping(): Promise<{ ok: true }>;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

let httpDb: { url: string; db: NeonHttpDatabase<Schema> } | undefined;

function getHttpDb(): NeonHttpDatabase<Schema> {
  const url = connectionString();
  if (!httpDb || httpDb.url !== url) {
    httpDb = { url, db: drizzleHttp({ client: neon(url), schema }) };
  }
  return httpDb.db;
}

const transaction: NeonDatabase<Schema>["transaction"] = async (fn, config) => {
  const pool = new Pool({ connectionString: connectionString() });
  try {
    const wsDb = drizzleWs({ client: pool, schema });
    return await wsDb.transaction(fn, config);
  } finally {
    await pool.end().catch(() => {});
  }
};

async function ping(): Promise<{ ok: true }> {
  const sql = neon(connectionString());
  await sql`select 1`;
  return { ok: true };
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    if (prop === "transaction") return transaction;
    if (prop === "ping") return ping;
    const target = getHttpDb() as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

/**
 * Postgres error code and constraint for a failed query. Drizzle wraps driver
 * errors (the original is on `.cause`), so look through the chain.
 */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

/** True when the error is a unique-constraint violation (optionally a specific one). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const info = pgError(err);
  return info.code === "23505" && (constraint === undefined || info.constraint === constraint);
}
