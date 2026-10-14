CREATE TABLE "dealer_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer NOT NULL,
	"hostname" text NOT NULL,
	"kind" text NOT NULL,
	"cf_hostname_id" text,
	"cf_route_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ssl_status" text,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
ALTER TABLE "dealer_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "dealer_domains_dealer_idx" ON "dealer_domains" USING btree ("dealer_id");