CREATE TABLE "rollout_dealers" (
	"id" serial PRIMARY KEY NOT NULL,
	"rollout_id" integer NOT NULL,
	"dealer_id" integer NOT NULL,
	"wave" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rollout_dealers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rollouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"release" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'running' NOT NULL,
	"started_by" text NOT NULL,
	"github_run_url" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rollouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "modules_on" jsonb;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "modules_off" jsonb;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "release" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rollout_dealers_rollout_idx" ON "rollout_dealers" USING btree ("rollout_id");--> statement-breakpoint
CREATE INDEX "rollout_dealers_dealer_idx" ON "rollout_dealers" USING btree ("dealer_id");