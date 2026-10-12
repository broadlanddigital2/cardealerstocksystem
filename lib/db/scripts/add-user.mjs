// Adds (or updates the role of) a staff login in app_users.
//   EMAIL=someone@example.com ROLE=admin|user DATABASE_URL=... node scripts/add-user.mjs
// Used by the "Add staff user" workflow until the console can do this.
import pg from "pg";

const raw = process.env.DATABASE_URL;
const email = (process.env.EMAIL ?? "").trim().toLowerCase();
const role = (process.env.ROLE ?? "user").trim();
if (!raw) {
  console.error("Error: DATABASE_URL is not set");
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Error: EMAIL is not a valid email address");
  process.exit(1);
}
if (role !== "admin" && role !== "user") {
  console.error('Error: ROLE must be "admin" or "user"');
  process.exit(1);
}

const url = new URL(raw);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
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
  const updated = await client.query(
    "update app_users set role = $2, updated_at = now() where lower(email) = $1 returning id",
    [email, role],
  );
  const action = updated.rowCount
    ? "updated"
    : (await client.query("insert into app_users (email, role) values ($1, $2)", [email, role]), "added");
  console.log(`Staff user ${action} (${role}).`);
  console.log(`::notice title=Staff user ${action}::role ${role}`);
} catch (err) {
  console.error("Error: could not add user:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
