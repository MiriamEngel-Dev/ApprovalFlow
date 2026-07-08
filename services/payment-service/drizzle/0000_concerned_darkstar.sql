CREATE TABLE IF NOT EXISTS "department_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department" varchar(128) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"reserved" numeric(14, 2) DEFAULT '0' NOT NULL,
	"spent" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "department_budgets_department_unique" UNIQUE("department"),
	CONSTRAINT "department_budgets_no_overspend_check" CHECK ("department_budgets"."reserved" + "department_budgets"."spent" <= "department_budgets"."total")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('completed', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"department" varchar(128) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"saga_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_submission_unique" UNIQUE("submission_id"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" IN ('active', 'confirmed', 'released', 'compensated'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_status_idx" ON "reservations" USING btree ("status","created_at");