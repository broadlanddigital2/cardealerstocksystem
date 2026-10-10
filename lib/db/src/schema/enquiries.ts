import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Customer enquiries (leads) submitted from the public showroom. Scoped to the
// single shared dealer tenant; vehicleId is optional (a general enquiry).
export const enquiriesTable = pgTable(
  "enquiries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    vehicleId: integer("vehicle_id"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    message: text("message").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("enquiries_user_id_idx").on(table.userId)],
).enableRLS();

export const insertEnquirySchema = createInsertSchema(enquiriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEnquiry = z.infer<typeof insertEnquirySchema>;
export type Enquiry = typeof enquiriesTable.$inferSelect;
