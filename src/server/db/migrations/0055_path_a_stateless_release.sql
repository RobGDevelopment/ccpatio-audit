ALTER TYPE "public"."saga_status" ADD VALUE IF NOT EXISTS 'AWAITING_DEPOSIT';--> statement-breakpoint
CREATE TABLE "custom_build_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"global_sku" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"design_status" text DEFAULT 'awaiting_cad' NOT NULL,
	"cad_upload_id" uuid,
	"finalized_dossier_hash" text,
	"finalized_at" timestamp with time zone,
	"finalized_by" text,
	"katana_sales_order_row_id" integer,
	"katana_mo_id" integer,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_build_job_items_global_sku_unique" UNIQUE("global_sku"),
	CONSTRAINT "custom_build_job_items_quantity_positive" CHECK ("custom_build_job_items"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "custom_build_job_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_sales_order_id" integer;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_order_no" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_mo_ids" jsonb;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_sync_hash" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "release_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "release_source" text;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "release_requested_by" text;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "deposit_ref" text;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "deposit_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "release_attempts" integer;--> statement-breakpoint
ALTER TABLE "saga_runs" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_job_items" ADD CONSTRAINT "custom_build_job_items_job_id_custom_build_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."custom_build_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_build_job_items" ADD CONSTRAINT "custom_build_job_items_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_build_job_items" ADD CONSTRAINT "custom_build_job_items_cad_upload_id_cad_uploads_id_fk" FOREIGN KEY ("cad_upload_id") REFERENCES "public"."cad_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_build_job_items_job_idx" ON "custom_build_job_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "saga_runs_awaiting_deposit_idx" ON "saga_runs" USING btree ("updated_at") WHERE "saga_runs"."status" = 'AWAITING_DEPOSIT';--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "custom_build_job_items" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
