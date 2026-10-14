import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

// The console's own database. It holds dealers' business details, plans and
// module settings only, never their stock or customer data (that lives in
// each dealer's own database).

export const dealersTable = pgTable("dealers", {
  id: serial("id").primaryKey(),
  /** Short id used in resource names, e.g. "manor-garage" -> stockbook-manor-garage. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  companyNumber: text("company_number"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  billingEmail: text("billing_email"),
  /** Dealer's own web domain, e.g. manorgcs.co.uk (email sender, showroom). */
  webDomain: text("web_domain"),
  /** Address staff use; default <slug>.stockbook.<platform domain>. */
  staffDomain: text("staff_domain"),
  /** Public showroom address, if any. */
  showroomDomain: text("showroom_domain"),
  firstAdminEmail: text("first_admin_email").notNull(),
  /** Module keys from @workspace/modules. */
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  /** draft | provisioning | active | failed | suspended */
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  /** Set by the setup job. */
  neonProjectId: text("neon_project_id"),
  workerName: text("worker_name"),
  siteUrl: text("site_url"),
  /** Lets the console change this dealer's modules (Bearer token for /api/platform/modules). */
  platformSecret: text("platform_secret"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

/** Who changed what, for every change made in the console. */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorEmail: text("actor_email").notNull(),
    dealerId: integer("dealer_id"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_log_dealer_idx").on(t.dealerId, t.at)],
).enableRLS();

/** Emailed sign-in codes (hash only). */
export const consoleAuthCodesTable = pgTable(
  "console_auth_codes",
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
  (t) => [index("console_auth_codes_email_idx").on(t.email, t.createdAt)],
).enableRLS();

/** Signed-in browsers (SHA-256 of the cookie token). */
export const consoleSessionsTable = pgTable("console_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}).enableRLS();

export type Dealer = typeof dealersTable.$inferSelect;

/** Progress of the latest setup run for each dealer (one row per step). */
export const setupStepsTable = pgTable(
  "setup_steps",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    runId: text("run_id").notNull(),
    position: integer("position").notNull(),
    step: text("step").notNull(),
    /** pending | running | done | failed */
    status: text("status").notNull().default("pending"),
    message: text("message"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("setup_steps_dealer_idx").on(t.dealerId, t.runId)],
).enableRLS();

export type SetupStep = typeof setupStepsTable.$inferSelect;
