import { pgTable, serial, text, integer, jsonb, timestamp, numeric, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { Vehicle } from "./vehicles";
import type { Invoice } from "./invoices";

export type IssuedAccounting = {
  margin: number | null;
  vatDue: number | null;
  netMargin: number | null;
  totalMargin: number;
  gross: number;
  net: number;
  vat: number;
};

// No vehicle/invoice/actor foreign keys: accounting history must survive deletion.
export const issuedSalesTable = pgTable("issued_sales", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  actor: text("actor").notNull(),
  reviewEvidence: jsonb("review_evidence").$type<{ documentReference: string; notes: string; expectedEditVersion: string }>(),
  vehicle: jsonb("vehicle").$type<Vehicle & { issuedAccounting?: IssuedAccounting }>().notNull(),
  invoice: jsonb("invoice").$type<Invoice>().notNull(),
  accountingSettings: jsonb("accounting_settings").$type<{ vatRate: string | null; vatQualifyingCode: string | null; carSalesCode: string | null; carPurchasesCode: string | null; stockCode: string | null; otherSalesCode: string | null }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("issued_sales_vehicle_unique").on(t.userId, t.vehicleId),
  uniqueIndex("issued_sales_invoice_unique").on(t.userId, t.invoiceNumber),
]);

export const saleCreditsTable = pgTable("sale_credits", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  issuedSaleId: integer("issued_sale_id").notNull(),
  creditNumber: text("credit_number").notNull(),
  cancellationDate: date("cancellation_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  receivedAmount: numeric("received_amount", { precision: 14, scale: 2 }).notNull(),
  reconciliation: text("reconciliation").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("sale_credits_sale_unique").on(t.userId, t.issuedSaleId),
  uniqueIndex("sale_credits_number_unique").on(t.userId, t.creditNumber),
]);

export const saleRefundsTable = pgTable("sale_refunds", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  creditId: integer("credit_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  recipient: text("recipient").notNull(),
  method: text("method").notNull(),
  reference: text("reference").notNull(),
  requestKey: text("request_key").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason"),
  returnedVehicleId: integer("returned_vehicle_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("sale_refunds_request_unique").on(t.userId, t.requestKey),
  uniqueIndex("sale_refunds_reference_unique").on(t.userId, t.reference),
]);

export const insertIssuedSaleSchema = createInsertSchema(issuedSalesTable).omit({ id: true, createdAt: true });
export const insertSaleCreditSchema = createInsertSchema(saleCreditsTable).omit({ id: true, createdAt: true });
export const insertSaleRefundSchema = createInsertSchema(saleRefundsTable).omit({ id: true, createdAt: true });
export type IssuedSale = typeof issuedSalesTable.$inferSelect;
export type SaleCredit = typeof saleCreditsTable.$inferSelect;
export type SaleRefund = typeof saleRefundsTable.$inferSelect;

// Append-only correction history. No FK cascades or update/delete API.
export const vehicleRevisionsTable = pgTable("vehicle_revisions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  issuedSaleId: integer("issued_sale_id"),
  actor: text("actor").notNull(),
  beforeVehicle: jsonb("before_vehicle").$type<Vehicle>().notNull(),
  afterVehicle: jsonb("after_vehicle").$type<Vehicle & { issuedAccounting?: IssuedAccounting }>().notNull(),
  beforeInvoice: jsonb("before_invoice").$type<Invoice | null>(),
  afterInvoice: jsonb("after_invoice").$type<Invoice | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
