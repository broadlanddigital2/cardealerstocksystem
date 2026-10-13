import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Staff roles for this site. "admin" is built in (every module, plus Settings
// and Users) and is not stored here. The role with key "user" is the default
// "Staff" role: it always exists and can be renamed but not deleted.
// app_users.role holds "admin" or one of these keys.
export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** Module keys (see apps/web/src/lib/modules.ts). */
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export type Role = typeof rolesTable.$inferSelect;
