CREATE TABLE IF NOT EXISTS "provider_charges" (
	"idempotency_key" varchar(256) PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"provider_ref" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_charges_status_check" CHECK ("provider_charges"."status" IN ('charged', 'declined'))
);
