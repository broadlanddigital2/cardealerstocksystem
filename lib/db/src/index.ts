import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return url;
}

function makePool(max: number): pg.Pool {
  const url = connectionString();
  const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
  return new Pool({
    connectionString: url,
    max,
    // Supabase requires TLS; its pooler certificate chain is not in the
    // Workers/Node default store, so verify-full is not attempted here.
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
}

// Request-scoped database.
//
// On Cloudflare Workers a socket opened while handling one request cannot be
// used by another, so a long-lived module-level Pool breaks. Each API request is
// therefore wrapped in `withRequestDb()`, which opens a small pool for that
// request and closes it afterwards. Code outside a request scope (tests,
// scripts, `next dev` on Node) falls back to one shared pool.
interface Scope {
  db: Database;
  pool: pg.Pool;
}

// Request scope holds a lazily-created pool: requests that never touch the
// database (health checks, static API responses) never open a connection.
interface LazyScope {
  current: Scope | null;
}

const requestScope = new AsyncLocalStorage<LazyScope>();
let shared: Scope | null = null;

function current(): Scope {
  const scoped = requestScope.getStore();
  if (scoped) {
    if (!scoped.current) {
      const p = makePool(Number(process.env.DB_POOL_MAX ?? 3));
      scoped.current = { pool: p, db: drizzle(p, { schema }) };
    }
    return scoped.current;
  }
  if (!shared) {
    const p = makePool(Number(process.env.DB_POOL_MAX ?? 5));
    shared = { pool: p, db: drizzle(p, { schema }) };
  }
  return shared;
}

export async function withRequestDb<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.DB_SCOPE !== "request") return fn();
  const scope: LazyScope = { current: null };
  try {
    return await requestScope.run(scope, fn);
  } finally {
    scope.current?.pool.end().catch(() => {});
  }
}

// `db` and `pool` are proxies so existing `import { db } from "@workspace/db"`
// call sites keep working unchanged while resolving to the right scope.
export const db: Database = new Proxy({} as Database, {
  get(_t, prop) {
    const target = current().db as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_t, prop) {
    const target = current().pool as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

/** Exposed for operator diagnostics only. */
export const pgDriver = pg;

export * from "./schema";
