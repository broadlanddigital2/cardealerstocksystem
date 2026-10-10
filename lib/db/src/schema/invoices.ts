import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  jsonb,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    customerName: text("customer_name").notNull(),
    customerAddress: text("customer_address").notNull(),
    salePrice: numeric("sale_price").notNull(),
    saleVat: numeric("sale_vat"),
    paymentMethod: text("payment_method"),
    partExchangeAllowance: numeric("part_exchange_allowance"),
    balancePayable: numeric("balance_payable").notNull(),
    holdingDeposit: numeric("holding_deposit"),
    extras: jsonb("extras").$type<
      Array<{
        description: string;
        amount: number;
        vat?: number;
        onFinanceInvoice?: boolean;
      }>
    >(),
    extrasOnFinanceInvoice: boolean("extras_on_finance_invoice")
      .notNull()
      .default(false),
    notes: text("notes"),
    financeCompanyName: text("finance_company_name"),
    financeCompanyAddress: text("finance_company_address"),
    financeCompanyEmail: text("finance_company_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("invoices_user_id_idx").on(table.userId),
    index("invoices_vehicle_id_idx").on(table.vehicleId),
    uniqueIndex("invoices_user_invoice_number_idx").on(
      table.userId,
      table.invoiceNumber,
    ),
  ],
).enableRLS();

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
