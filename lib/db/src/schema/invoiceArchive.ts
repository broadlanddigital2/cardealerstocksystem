import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Deliberately no foreign keys: these records survive deletion of live stock.
export const invoiceArchiveTable = pgTable("invoice_archive", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceSnapshot: jsonb("invoice_snapshot").$type<Record<string, unknown>>(),
  vehicleSnapshot: jsonb("vehicle_snapshot").$type<Record<string, unknown>>().notNull(),
  reason: text("reason").notNull().default("vehicle_deleted"),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("invoice_archive_user_number_idx").on(table.userId, table.invoiceNumber),
]);

export const insertInvoiceArchiveSchema = createInsertSchema(invoiceArchiveTable).omit({ id: true, archivedAt: true });
export type InsertInvoiceArchive = z.infer<typeof insertInvoiceArchiveSchema>;
export type InvoiceArchive = typeof invoiceArchiveTable.$inferSelect;
