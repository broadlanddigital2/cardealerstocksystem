import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const depositRefundsTable = pgTable(
  "deposit_refunds",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    stockNumber: text("stock_number").notNull(),
    registrationNumber: text("registration_number").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    depositAmount: numeric("deposit_amount").notNull(),
    depositDate: text("deposit_date"),
    depositReference: text("deposit_reference"),
    buyerName: text("buyer_name"),
    buyerAddress: text("buyer_address"),
    refundDate: text("refund_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("deposit_refunds_user_id_idx").on(table.userId),
    index("deposit_refunds_vehicle_id_idx").on(table.vehicleId),
  ],
);

export const insertDepositRefundSchema = createInsertSchema(
  depositRefundsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertDepositRefund = z.infer<typeof insertDepositRefundSchema>;
export type DepositRefund = typeof depositRefundsTable.$inferSelect;
