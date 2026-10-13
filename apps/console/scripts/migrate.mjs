// Applies the console's SQL migrations (./migrations) to DATABASE_URL.
// Uses its own migrations table so it can never be confused with a dealer
// database's.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("Error: DATABASE_URL is not set");
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
  await client.connect();
  await migrate(drizzle(client), {
    migrationsFolder: path.join(here, "../migrations"),
    migrationsSchema: "drizzle",
    migrationsTable: "__console_migrations",
  });
  console.log("Console migrations up to date.");
} catch (err) {
  console.error("Error: console migration failed:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
