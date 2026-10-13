-- 0054_sre_dlq_saga_buckets.sql
-- Phase 9 (SRE primitives). ADDITIVE ONLY: CREATE TYPE / CREATE TABLE / CREATE INDEX /
-- ENABLE ROW LEVEL SECURITY. No existing object is dropped or altered.
--
-- RLS is enabled with NO policies (deny-all for the Supabase Data API). App access is
-- POSTGRES_URL (table owner), which bypasses RLS. Same convention as
-- 0053_rls_qbo_tokens_incoming_webhooks.sql. FORCE ROW LEVEL SECURITY is NOT used.
-- The REVOKEs are guarded so databases without the Supabase roles do not fail.

CREATE TYPE "public"."saga_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPENSATING', 'COMPENSATED', 'SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION');--> statement-breakpoint
CREATE TABLE "dlq_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"function_id" text NOT NULL,
	"event_id" text,
	"event_name" text NOT NULL,
	"error_name" text,
	"error_message" text NOT NULL,
	"error_stack" text,
	"original_event" jsonb NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dlq_events_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "dlq_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saga_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saga_type" text NOT NULL,
	"correlation_key" text NOT NULL,
	"status" "saga_status" DEFAULT 'PENDING' NOT NULL,
	"current_step" text,
	"paid_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saga_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "dlq_events_function_created_idx" ON "dlq_events" USING btree ("function_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saga_runs_type_correlation_uidx" ON "saga_runs" USING btree ("saga_type","correlation_key");
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "dlq_events" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "saga_runs" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "rate_limit_buckets" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
