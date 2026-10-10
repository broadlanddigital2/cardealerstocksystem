import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// App access list (single-dealer mode). Each row is an invited user identified by
// email, with a permission level. Admins manage this list from the Settings
// "Users" tab; it is the runtime source of truth for who may sign in and at what
// level, replacing the static ALLOWED_EMAILS / ADMIN_EMAILS env vars (which are
// kept only as a backstop). The hardcoded operator (ALWAYS_ADMIN_EMAILS) is
// always an admin regardless of this table.
export const appUsersTable = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Case-insensitive uniqueness: emails are matched lowercased everywhere, so
    // the DB must reject mixed-case duplicates of the same address.
    uniqueIndex("app_users_email_lower_unique").on(sql`lower(${table.email})`),
  ],
).enableRLS();

export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type AppUser = typeof appUsersTable.$inferSelect;
