CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stock_number" text NOT NULL,
	"purchase_number" text NOT NULL,
	"registration_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"vin" text,
	"colour" text,
	"description" text,
	"mileage_at_purchase" integer,
	"purchase_date" text NOT NULL,
	"purchase_invoice_number" text,
	"purchase_type" text NOT NULL,
	"seller_name" text NOT NULL,
	"seller_address" text,
	"purchase_price" numeric NOT NULL,
	"vat_qualifying" boolean DEFAULT false NOT NULL,
	"purchase_vat" numeric,
	"purchase_notes" text,
	"purchase_document_reference" text,
	"auction_cost_no_vat" numeric,
	"auction_cost_with_vat" numeric,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"holding_deposit_amount" numeric,
	"holding_deposit_date" text,
	"holding_deposit_reference" text,
	"holding_deposit_payment_method" text,
	"sale_date" text,
	"sales_invoice_number" text,
	"buyer_name" text,
	"buyer_address" text,
	"buyer_email" text,
	"buyer_phone" text,
	"sale_price" numeric,
	"sale_vat" numeric,
	"mileage_at_sale" integer,
	"method_of_disposal" text,
	"sale_notes" text,
	"invoice_notes" text,
	"payment_method" text,
	"number_of_payments" integer,
	"payments" jsonb,
	"part_exchange_allowance" numeric,
	"part_exchange_make" text,
	"part_exchange_model" text,
	"part_exchange_registration" text,
	"part_exchange_mileage" integer,
	"part_exchange_vehicle_id" integer,
	"asking_price" numeric,
	"marketing_description" text,
	"published" boolean DEFAULT false NOT NULL,
	"showroom_sold" boolean DEFAULT false NOT NULL,
	"showroom_remove_at" timestamp with time zone,
	"photo_urls" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"address" text,
	"vat_number" text,
	"business_type" text DEFAULT 'Limited Company' NOT NULL,
	"company_name" text,
	"company_number" text,
	"place_of_registration" text,
	"registered_office_address" text,
	"phone" text,
	"email" text,
	"website" text,
	"bank_account_name" text,
	"bank_name" text,
	"bank_sort_code" text,
	"bank_account_number" text,
	"logo_path" text,
	"margin_scheme_wording" text,
	"default_invoice_wording" text DEFAULT '' NOT NULL,
	"invoice_accent_colour" text,
	"vat_quarter" text,
	"vat_rate" text,
	"car_sales_code" text,
	"vat_qualifying_code" text,
	"other_sales_code" text,
	"car_purchases_code" text,
	"stock_code" text,
	"auction_cost_no_vat_code" text,
	"auction_cost_vat_code" text,
	"cash_opening_balance" numeric,
	"finance_provided" boolean DEFAULT false NOT NULL,
	"finance_frn_number" text,
	"finance_wording" text,
	"showroom_enabled" boolean DEFAULT true NOT NULL,
	"showroom_headline" text,
	"showroom_intro" text,
	"showroom_about_title" text,
	"showroom_features" jsonb,
	"showroom_reviews" jsonb,
	"showroom_bg_colour" text,
	"showroom_bg_text_colour" text,
	"cazoo_dealer_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_address" text NOT NULL,
	"sale_price" numeric NOT NULL,
	"sale_vat" numeric,
	"payment_method" text,
	"part_exchange_allowance" numeric,
	"balance_payable" numeric NOT NULL,
	"holding_deposit" numeric,
	"extras" jsonb,
	"extras_on_finance_invoice" boolean DEFAULT false NOT NULL,
	"notes" text,
	"finance_company_name" text,
	"finance_company_address" text,
	"finance_company_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"address" text,
	"phone" text,
	"email" text,
	"vat_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"stock_number" text NOT NULL,
	"registration_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"deposit_amount" numeric NOT NULL,
	"deposit_date" text,
	"deposit_reference" text,
	"buyer_name" text,
	"buyer_address" text,
	"refund_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"message" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "stored_objects" (
	"object_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"content_type" text,
	"size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vehicles_user_id_idx" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_stock_number_idx" ON "vehicles" USING btree ("user_id","stock_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_purchase_number_idx" ON "vehicles" USING btree ("user_id","purchase_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_reg_in_stock_idx" ON "vehicles" USING btree ("user_id",lower("registration_number")) WHERE "vehicles"."status" <> 'sold';--> statement-breakpoint
CREATE INDEX "invoices_user_id_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_vehicle_id_idx" ON "invoices" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_user_invoice_number_idx" ON "invoices" USING btree ("user_id","invoice_number");--> statement-breakpoint
CREATE INDEX "deposit_refunds_user_id_idx" ON "deposit_refunds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposit_refunds_vehicle_id_idx" ON "deposit_refunds" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "cash_expenses_user_id_idx" ON "cash_expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "enquiries_user_id_idx" ON "enquiries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_email_lower_unique" ON "app_users" USING btree (lower("email"));