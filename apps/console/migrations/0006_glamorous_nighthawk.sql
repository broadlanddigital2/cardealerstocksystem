ALTER TABLE "dealers" ADD COLUMN "removal_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "delete_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "remove_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "export_keys" jsonb;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "export_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "removed_at" timestamp with time zone;