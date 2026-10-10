// Applies pending SQL migrations from ./migrations to DATABASE_URL.
// Uses drizzle-orm's migrator directly so database errors are printed in full
// (drizzle-kit's CLI swallows them).
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const url = new URL(raw);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
const here = path.dirname(fileURLToPath(import.meta.url));

const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, "") || "postgres",
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

try {
  console.log(`Connecting to ${url.hostname}:${url.port || 5432} as ${decodeURIComponent(url.username)} …`);
  await client.connect();
  const before = await client
    .query("select count(*)::int as n from drizzle.__drizzle_migrations")
    .then((r) => r.rows[0].n)
    .catch(() => 0);
  await migrate(drizzle(client), { migrationsFolder: path.join(here, "../migrations") });
  const after = await client
    .query("select count(*)::int as n from drizzle.__drizzle_migrations")
    .then((r) => r.rows[0].n);
  console.log(`Migrations up to date (${after - before} applied, ${after} total).`);
} catch (err) {
  console.error("Error: migration failed:", err?.message ?? err);
  if (err?.code) console.error("Error: postgres code:", err.code, err.detail ?? "", err.hint ?? "");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
