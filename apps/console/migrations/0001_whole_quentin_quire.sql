CREATE TABLE "setup_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"position" integer NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setup_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "neon_project_id" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "worker_name" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "platform_secret" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "provisioned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "setup_steps_dealer_idx" ON "setup_steps" USING btree ("dealer_id","run_id");