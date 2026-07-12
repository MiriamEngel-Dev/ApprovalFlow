ALTER TABLE "approval_queue" ADD COLUMN "department" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_queue" ADD COLUMN "amount" numeric(12, 2) NOT NULL;