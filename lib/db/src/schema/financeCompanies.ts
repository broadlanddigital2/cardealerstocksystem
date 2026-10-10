import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financeCompaniesTable = pgTable("finance_companies", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertFinanceCompanySchema = createInsertSchema(
  financeCompaniesTable,
).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFinanceCompany = z.infer<typeof insertFinanceCompanySchema>;
export type FinanceCompany = typeof financeCompaniesTable.$inferSelect;
