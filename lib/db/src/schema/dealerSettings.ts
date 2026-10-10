import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A single "why buy from us" card on the public showroom home page.
// iconPath is an optional dealer-uploaded image/icon (object-storage path);
// when absent the showroom falls back to a default icon.
export type ShowroomFeature = { title: string; body: string; iconPath?: string };

// A single customer review shown on the public showroom home page. Entered
// manually by the dealer (no third-party/Google API). rating is 1-5; date is an
// optional free-text label (e.g. "March 2024").
export type ShowroomReview = {
  author: string;
  rating: number;
  text: string;
  date?: string;
};

export const dealerSettingsTable = pgTable("dealer_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  businessName: text("business_name").notNull().default(""),
  address: text("address"),
  vatNumber: text("vat_number"),
  businessType: text("business_type").notNull().default("Limited Company"),
  companyName: text("company_name"),
  companyNumber: text("company_number"),
  placeOfRegistration: text("place_of_registration"),
  registeredOfficeAddress: text("registered_office_address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  bankAccountName: text("bank_account_name"),
  bankName: text("bank_name"),
  bankSortCode: text("bank_sort_code"),
  bankAccountNumber: text("bank_account_number"),
  logoPath: text("logo_path"),
  // The standard VAT Margin Scheme footer for second-hand goods invoices.
  // Auto-populated (and editable) in the VAT settings once a VAT number is set.
  marginSchemeWording: text("margin_scheme_wording"),
  // Optional extra footer wording (bank details, terms, etc.) appended below the
  // margin-scheme wording on invoices.
  defaultInvoiceWording: text("default_invoice_wording").notNull().default(""),
  invoiceAccentColour: text("invoice_accent_colour"),
  vatQuarter: text("vat_quarter"),
  vatRate: text("vat_rate"),
  carSalesCode: text("car_sales_code"),
  vatQualifyingCode: text("vat_qualifying_code"),
  otherSalesCode: text("other_sales_code"),
  carPurchasesCode: text("car_purchases_code"),
  stockCode: text("stock_code"),
  auctionCostNoVatCode: text("auction_cost_no_vat_code"),
  auctionCostVatCode: text("auction_cost_vat_code"),
  cashOpeningBalance: numeric("cash_opening_balance"),
  // Finance (FCA-regulated credit broking) details shown on the showroom.
  financeProvided: boolean("finance_provided").notNull().default(false),
  financeFrnNumber: text("finance_frn_number"),
  financeWording: text("finance_wording"),
  // Public showroom (customer-facing website) settings.
  showroomEnabled: boolean("showroom_enabled").notNull().default(true),
  showroomHeadline: text("showroom_headline"),
  showroomIntro: text("showroom_intro"),
  showroomAboutTitle: text("showroom_about_title"),
  showroomFeatures: jsonb("showroom_features").$type<ShowroomFeature[]>(),
  showroomReviews: jsonb("showroom_reviews").$type<ShowroomReview[]>(),
  // Optional custom colours for the showroom's dark sections (hero, footer,
  // CTA, page headings). When null the showroom falls back to its defaults.
  showroomBgColour: text("showroom_bg_colour"),
  showroomBgTextColour: text("showroom_bg_text_colour"),
  // The dealer's own Cazoo dealer-page URL, remembered automatically after a
  // successful "Import from Cazoo" preview. Used by the daily Cazoo health
  // check that warns admins if Cazoo redesign their site and imports break.
  cazooDealerUrl: text("cazoo_dealer_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export const insertDealerSettingsSchema = createInsertSchema(
  dealerSettingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealerSettings = z.infer<typeof insertDealerSettingsSchema>;
export type DealerSettings = typeof dealerSettingsTable.$inferSelect;
