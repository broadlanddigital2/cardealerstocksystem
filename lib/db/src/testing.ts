// For server tests only: the same Drizzle schema and query API as `db`, but
// over the standard Postgres driver, so tests can run against the plain
// Postgres service in CI (Neon's serverless driver can't reach it). Never
// imported by app code.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function createTestDb(url = process.env.TEST_DATABASE_URL) {
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const base = drizzle({ client: pool, schema });
  const db = Object.assign(base, {
    async ping(): Promise<{ ok: true }> {
      await pool.query("select 1");
      return { ok: true };
    },
  });
  return { db, pool };
}

/** True when server database tests can run (CI sets this to its Postgres service). */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
