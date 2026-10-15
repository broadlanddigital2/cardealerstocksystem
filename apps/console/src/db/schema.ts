import { pgTable, serial, text, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";

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
  /** The modules this dealer has today (for display). Derived from the exceptions below. */
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  /** Premium modules switched on for this dealer. Null on records made before tiers (read from `modules`). */
  modulesOn: jsonb("modules_on").$type<string[]>(),
  /** Included modules switched off for this dealer. */
  modulesOff: jsonb("modules_off").$type<string[]>(),
  /** Pilot dealers get each release first; the rest only if every pilot updated cleanly. */
  pilot: boolean("pilot").notNull().default(false),
  /** Release (git commit) the dealer's site is running, and when it was updated. */
  release: text("release"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
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

/** A dealer's own web address (staff app or public showroom), served via Cloudflare for SaaS. */
export const dealerDomainsTable = pgTable(
  "dealer_domains",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    hostname: text("hostname").notNull().unique(),
    /** staff | showroom */
    kind: text("kind").notNull(),
    cfHostnameId: text("cf_hostname_id"),
    cfRouteId: text("cf_route_id"),
    /** pending | active | error (Cloudflare's custom-hostname status, simplified) */
    status: text("status").notNull().default("pending"),
    sslStatus: text("ssl_status"),
    /** DNS records the dealer must add: [{ type, name, value }] */
    records: jsonb("records").$type<{ type: string; name: string; value: string }[]>().notNull().default([]),
    message: text("message"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dealer_domains_dealer_idx").on(t.dealerId)],
).enableRLS();

export type DealerDomain = typeof dealerDomainsTable.$inferSelect;

/** A release being rolled out to every dealer (one per commit on main / develop). */
export const rolloutsTable = pgTable("rollouts", {
  id: serial("id").primaryKey(),
  /** Git commit being released. */
  release: text("release").notNull(),
  /** Commit message headline. */
  title: text("title"),
  /** running | done | failed | stopped */
  status: text("status").notNull().default("running"),
  startedBy: text("started_by").notNull(),
  githubRunUrl: text("github_run_url"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}).enableRLS();

export type Rollout = typeof rolloutsTable.$inferSelect;

/** One dealer's part of a rollout. */
export const rolloutDealersTable = pgTable(
  "rollout_dealers",
  {
    id: serial("id").primaryKey(),
    rolloutId: integer("rollout_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    /** 1 = pilot dealers, 2 = everyone else */
    wave: integer("wave").notNull(),
    /** waiting | running | done | failed | skipped */
    status: text("status").notNull().default("waiting"),
    message: text("message"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rollout_dealers_rollout_idx").on(t.rolloutId), index("rollout_dealers_dealer_idx").on(t.dealerId)],
).enableRLS();

export type RolloutDealer = typeof rolloutDealersTable.$inferSelect;
