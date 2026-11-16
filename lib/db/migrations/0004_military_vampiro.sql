CREATE TABLE "invoice_archive" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_snapshot" jsonb,
	"vehicle_snapshot" jsonb NOT NULL,
	"reason" text DEFAULT 'vehicle_deleted' NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issued_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"actor" text NOT NULL,
	"review_evidence" jsonb,
	"vehicle" jsonb NOT NULL,
	"invoice" jsonb NOT NULL,
	"accounting_settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issued_sale_id" integer NOT NULL,
	"credit_number" text NOT NULL,
	"cancellation_date" date NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"received_amount" numeric(14, 2) NOT NULL,
	"reconciliation" text NOT NULL,
	"request" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credit_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"recipient" text NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"request_key" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"returned_vehicle_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"issued_sale_id" integer,
	"actor" text NOT NULL,
	"before_vehicle" jsonb NOT NULL,
	"after_vehicle" jsonb NOT NULL,
	"before_invoice" jsonb,
	"after_invoice" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "returned_from_vehicle_id" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "stock_return_date" text;--> statement-breakpoint
ALTER TABLE "deposit_refunds" ADD COLUMN "actor" text;--> statement-breakpoint
CREATE INDEX "invoice_archive_user_number_idx" ON "invoice_archive" USING btree ("user_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_sales_vehicle_unique" ON "issued_sales" USING btree ("user_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_sales_invoice_unique" ON "issued_sales" USING btree ("user_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_credits_sale_unique" ON "sale_credits" USING btree ("user_id","issued_sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_credits_number_unique" ON "sale_credits" USING btree ("user_id","credit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_refunds_request_unique" ON "sale_refunds" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_refunds_reference_unique" ON "sale_refunds" USING btree ("user_id","reference");