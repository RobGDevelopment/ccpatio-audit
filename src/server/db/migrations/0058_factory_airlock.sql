-- 0058_factory_airlock.sql
-- Phase 15b (Factory Airlock dual-approval BOM pipeline). HAND-WRITTEN header over drizzle-kit generated DDL.
-- ADDITIVE ONLY: CREATE TYPE (new enum) / CREATE TABLE / ADD CONSTRAINT (new tables only) /
-- CREATE INDEX / ENABLE ROW LEVEL SECURITY / guarded REVOKE. No existing object is dropped or
-- altered. Never applied with `drizzle-kit push`.
--
-- factory_airlock_builds: one mutable header row per custom_build_job_items row tracking
-- draft -> pending_manager -> approved | rejected -> pushed.
-- factory_airlock_decisions: append-only designer and manager decision log.
-- RLS enabled with NO policies (deny-all for the Data API); grants revoked from anon and
-- authenticated. The app connects as the table owner via POSTGRES_URL.
CREATE TYPE "public"."factory_airlock_status" AS ENUM('draft', 'pending_manager', 'rejected', 'approved', 'pushed');--> statement-breakpoint
CREATE TABLE "factory_airlock_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_item_id" uuid NOT NULL,
	"root_sku" text NOT NULL,
	"status" "factory_airlock_status" DEFAULT 'draft' NOT NULL,
	"dossier_hash" varchar(64),
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factory_airlock_submitted_attested" CHECK ((status = 'draft') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
	CONSTRAINT "factory_airlock_approved_attested" CHECK (status NOT IN ('approved', 'pushed') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND dossier_hash IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "factory_airlock_builds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "factory_airlock_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_role" text NOT NULL,
	"comment" text,
	"dossier_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factory_airlock_decisions_action" CHECK ("factory_airlock_decisions"."action" in ('submit', 'approve', 'reject')),
	CONSTRAINT "factory_airlock_reject_comment" CHECK (("factory_airlock_decisions"."action" <> 'reject') OR ("factory_airlock_decisions"."comment" IS NOT NULL AND char_length(btrim("factory_airlock_decisions"."comment")) BETWEEN 10 AND 2000))
);
--> statement-breakpoint
ALTER TABLE "factory_airlock_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "factory_airlock_builds" ADD CONSTRAINT "factory_airlock_builds_job_item_id_custom_build_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."custom_build_job_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_airlock_builds" ADD CONSTRAINT "factory_airlock_builds_root_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("root_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "factory_airlock_decisions" ADD CONSTRAINT "factory_airlock_decisions_build_id_factory_airlock_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."factory_airlock_builds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "factory_airlock_builds_job_item_uidx" ON "factory_airlock_builds" USING btree ("job_item_id");--> statement-breakpoint
CREATE INDEX "factory_airlock_builds_status_idx" ON "factory_airlock_builds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "factory_airlock_decisions_build_idx" ON "factory_airlock_decisions" USING btree ("build_id","created_at");--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "factory_airlock_builds" FROM anon, authenticated;
  REVOKE ALL ON TABLE "factory_airlock_decisions" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
