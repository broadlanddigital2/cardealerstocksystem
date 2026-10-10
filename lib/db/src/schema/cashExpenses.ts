import {
  pgTable,
  text,
  serial,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cashExpensesTable = pgTable(
  "cash_expenses",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("cash_expenses_user_id_idx").on(table.userId)],
).enableRLS();

export const insertCashExpenseSchema = createInsertSchema(cashExpensesTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export type InsertCashExpense = z.infer<typeof insertCashExpenseSchema>;
export type CashExpense = typeof cashExpensesTable.$inferSelect;
