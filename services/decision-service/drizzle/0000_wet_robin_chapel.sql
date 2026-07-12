CREATE TABLE IF NOT EXISTS "approval_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"approver_id" varchar(256),
	"approver_note" varchar(2048),
	"request_info_note" varchar(2048),
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "approval_queue_submission_unique" UNIQUE("submission_id"),
	CONSTRAINT "approval_queue_status_check" CHECK ("approval_queue"."status" IN ('pending', 'approved', 'rejected', 'info_requested'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"route" varchar(16) NOT NULL,
	"agent_recommendation" varchar(16) NOT NULL,
	"agent_confidence" numeric(4, 3) NOT NULL,
	"agent_reasoning" varchar(2048) NOT NULL,
	"rules_cited" jsonb NOT NULL,
	"violations" jsonb NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_submission_version_unique" UNIQUE("submission_id","version"),
	CONSTRAINT "decisions_route_check" CHECK ("decisions"."route" IN ('auto_approve', 'human_review', 'reject', 'duplicate'))
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
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_submission_id_idx" ON "decisions" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx" ON "outbox" USING btree ("published_at");