import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

// Sign-in is handled by each site itself (no outside auth service):
// a 6-digit code is emailed, and a successful code creates a session.
// Only hashes are stored, never the code or the session token itself.

/** One emailed sign-in code. Valid for 10 minutes, 5 tries, single use. */
export const authCodesTable = pgTable(
  "auth_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    salt: text("salt").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_codes_email_idx").on(t.email, t.createdAt)],
).enableRLS();

/** A signed-in browser. The cookie holds a random token; we keep its SHA-256. */
export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("auth_sessions_email_idx").on(t.email)],
).enableRLS();

export type AuthSession = typeof authSessionsTable.$inferSelect;
