CREATE TABLE "module_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module_settings" ENABLE ROW LEVEL SECURITY;