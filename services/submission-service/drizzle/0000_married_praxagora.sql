CREATE TABLE IF NOT EXISTS "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"vendor" varchar(256) NOT NULL,
	"invoice_number" varchar(128) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"category" varchar(32) NOT NULL,
	"department" varchar(128) NOT NULL,
	"submitter" varchar(256) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_dedup_unique" UNIQUE("vendor","invoice_number","total")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_tracking_id_idx" ON "submissions" USING btree ("tracking_id");