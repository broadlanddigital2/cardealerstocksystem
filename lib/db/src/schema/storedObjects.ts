import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// Access-control records for uploaded files (logos, showroom photos, feature
// icons). Replaces the "custom:aclPolicy" object metadata the Replit/GCS
// storage used: the bytes live in Cloudflare R2, and a row here marks an
// upload as finalised with its visibility. Uploads with no row are orphans and
// are swept after 30 minutes.
export const storedObjectsTable = pgTable("stored_objects", {
  // Object id, i.e. the <id> in "/objects/uploads/<id>".
  objectId: text("object_id").primaryKey(),
  owner: text("owner").notNull(),
  visibility: text("visibility").notNull().default("private"),
  contentType: text("content_type"),
  size: integer("size"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type StoredObject = typeof storedObjectsTable.$inferSelect;

// Small key/value store for state that used to live in server memory (e.g. the
// last Cazoo health-check result). Serverless isolates don't share memory, so
// anything that must survive between requests is kept here.
export const systemStateTable = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();
