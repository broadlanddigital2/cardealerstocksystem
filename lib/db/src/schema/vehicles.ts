import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    stockNumber: text("stock_number").notNull(),
    purchaseNumber: text("purchase_number").notNull(),
    registrationNumber: text("registration_number").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    vin: text("vin"),
    colour: text("colour"),
    description: text("description"),
    mileageAtPurchase: integer("mileage_at_purchase"),
    purchaseDate: text("purchase_date").notNull(),
    purchaseInvoiceNumber: text("purchase_invoice_number"),
    purchaseType: text("purchase_type").notNull(),
    sellerName: text("seller_name").notNull(),
    sellerAddress: text("seller_address"),
    purchasePrice: numeric("purchase_price").notNull(),
    vatQualifying: boolean("vat_qualifying").notNull().default(false),
    purchaseVat: numeric("purchase_vat"),
    purchaseNotes: text("purchase_notes"),
    purchaseDocumentReference: text("purchase_document_reference"),
    auctionCostNoVat: numeric("auction_cost_no_vat"),
    auctionCostWithVat: numeric("auction_cost_with_vat"),
    status: text("status").notNull().default("in_stock"),
    holdingDepositAmount: numeric("holding_deposit_amount"),
    holdingDepositDate: text("holding_deposit_date"),
    holdingDepositReference: text("holding_deposit_reference"),
    holdingDepositPaymentMethod: text("holding_deposit_payment_method"),
    saleDate: text("sale_date"),
    salesInvoiceNumber: text("sales_invoice_number"),
    buyerName: text("buyer_name"),
    buyerAddress: text("buyer_address"),
    buyerEmail: text("buyer_email"),
    buyerPhone: text("buyer_phone"),
    salePrice: numeric("sale_price"),
    saleVat: numeric("sale_vat"),
    mileageAtSale: integer("mileage_at_sale"),
    methodOfDisposal: text("method_of_disposal"),
    saleNotes: text("sale_notes"),
    invoiceNotes: text("invoice_notes"),
    paymentMethod: text("payment_method"),
    numberOfPayments: integer("number_of_payments"),
    payments: jsonb("payments").$type<
      Array<{
        date: string;
        amount: number;
        paymentMethod: string | null;
        type: string | null;
      }>
    >(),
    partExchangeAllowance: numeric("part_exchange_allowance"),
    partExchangeMake: text("part_exchange_make"),
    partExchangeModel: text("part_exchange_model"),
    partExchangeRegistration: text("part_exchange_registration"),
    partExchangeMileage: integer("part_exchange_mileage"),
    partExchangeVehicleId: integer("part_exchange_vehicle_id"),
    // Showroom (public website) fields. These are dealer-controlled and safe to
    // expose publicly for published, in-stock vehicles.
    askingPrice: numeric("asking_price"),
    marketingDescription: text("marketing_description"),
    published: boolean("published").notNull().default(false),
    // Website-only "sold" flag. Independent of the accounting `status`: lets the
    // dealer show a published vehicle on the showroom with a SOLD banner without
    // going through (or before) the full sale-recording flow.
    showroomSold: boolean("showroom_sold").notNull().default(false),
    // When set, the vehicle is automatically removed from the public website at
    // this time after a sale (the "remove in 7 days" option). NULL means no
    // scheduled removal — kept until removed manually, or removed immediately.
    showroomRemoveAt: timestamp("showroom_remove_at", { withTimezone: true }),
    photoUrls: jsonb("photo_urls").$type<Array<string>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("vehicles_user_id_idx").on(table.userId),
    uniqueIndex("vehicles_user_stock_number_idx").on(
      table.userId,
      table.stockNumber,
    ),
    uniqueIndex("vehicles_user_purchase_number_idx").on(
      table.userId,
      table.purchaseNumber,
    ),
    uniqueIndex("vehicles_user_reg_in_stock_idx")
      .on(table.userId, sql`lower(${table.registrationNumber})`)
      .where(sql`${table.status} <> 'sold'`),
  ],
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
