import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Parse the URL so we can control TLS: hosted Postgres (Neon) requires SSL, but its
// certificate chain isn't in Node's default store, and newer `pg` treats
// `sslmode=require` as full verification. Encrypt without chain verification
// (same as the app's runtime pool).
const url = new URL(process.env.DATABASE_URL);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    ssl: isLocal ? false : { rejectUnauthorized: false },
  },
});
