-- 0057_katana_reverse_flow.sql
-- Phase 15 (Katana reverse flow). HAND-WRITTEN header over drizzle-kit generated DDL.
-- ADDITIVE ONLY: CREATE TABLE / ADD COLUMN (nullable) / CREATE INDEX / ENABLE ROW LEVEL
-- SECURITY. No existing object is dropped or altered. Never applied with `drizzle-kit push`.
--
-- katana_po_bills: one row per distinct Katana PO receipt state. The QBO requestid derives
-- from (katana_po_id, receipt_fingerprint[, redrive seq]), so a retry reuses it and a new
-- partial receipt gets a new one. A ledger failure is retried or parked for a human, never
-- rolled back; rows are never deleted. RLS enabled with NO policies (deny-all for the Data
-- API). The app uses POSTGRES_URL (owner).
--
-- order_intake / custom_build_jobs: nullable Katana status mirror columns. order_intake.status
-- and order_intake.version are never written by Phase 15.
-- factory_stage values (enforced in TS): in_production, build_complete, ready_to_ship, delivered.
CREATE TABLE "katana_po_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"katana_po_id" integer NOT NULL,
	"order_no" text NOT NULL,
	"receipt_fingerprint" text NOT NULL,
	"receipt_seq" integer NOT NULL,
	"action" text NOT NULL,
	"lines" jsonb NOT NULL,
	"delta_total_cents" integer NOT NULL,
	"qbo_request_id" text NOT NULL,
	"qbo_bill_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"receipt_date" date,
	"qbo_vendor_id" text,
	"katana_supplier_id" integer,
	"vendor_ref_error" text,
	"park_reason" text,
	"parked_run_id" text,
	"redrive_count" integer DEFAULT 0 NOT NULL,
	"redrive_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_drift" jsonb,
	"price_drift_approved_by" text,
	"price_drift_approved_at" timestamp with time zone,
	"resolution_kind" text,
	"resolution_ref" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "katana_po_bills_status_check" CHECK ("katana_po_bills"."status" in ('pending', 'posted', 'dry_run', 'no_delta', 'requires_manual_intervention', 'resolved_manually')),
	CONSTRAINT "katana_po_bills_action_check" CHECK ("katana_po_bills"."action" in ('purchase_order.received', 'purchase_order.partially_received')),
	CONSTRAINT "katana_po_bills_delta_nonnegative" CHECK ("katana_po_bills"."delta_total_cents" >= 0 or "katana_po_bills"."resolution_kind" = 'vendor_credit_issued'),
	CONSTRAINT "katana_po_bills_seq_positive" CHECK ("katana_po_bills"."receipt_seq" >= 1),
	CONSTRAINT "katana_po_bills_park_reason_check" CHECK ("katana_po_bills"."park_reason" is null or "katana_po_bills"."park_reason" in ('config_missing', 'vendor_qbo_id_missing', 'vendor_qbo_id_invalid', 'vendor_qbo_id_ambiguous', 'vendor_qbo_id_not_found', 'vendor_inactive', 'vendor_currency_mismatch', 'supplier_missing', 'supplier_not_found', 'currency_unsupported', 'qbo_rejected', 'qbo_bill_mismatch', 'price_drift', 'negative_receipt', 'po_frozen')),
	CONSTRAINT "katana_po_bills_parked_has_reason" CHECK ("katana_po_bills"."status" <> 'requires_manual_intervention' or "katana_po_bills"."park_reason" is not null),
	CONSTRAINT "katana_po_bills_resolution_kind_check" CHECK ("katana_po_bills"."resolution_kind" is null or "katana_po_bills"."resolution_kind" in ('entered_by_hand', 'vendor_credit_issued', 'katana_correction')),
	CONSTRAINT "katana_po_bills_resolved_stamped" CHECK ("katana_po_bills"."status" <> 'resolved_manually' or ("katana_po_bills"."resolution_kind" is not null and "katana_po_bills"."resolved_by" is not null and "katana_po_bills"."resolved_at" is not null)),
	CONSTRAINT "katana_po_bills_redrive_count_nonnegative" CHECK ("katana_po_bills"."redrive_count" >= 0),
	CONSTRAINT "katana_po_bills_vendor_id_format" CHECK ("katana_po_bills"."qbo_vendor_id" is null or "katana_po_bills"."qbo_vendor_id" ~ '^[1-9][0-9]{0,11}$')
);
--> statement-breakpoint
ALTER TABLE "katana_po_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_so_status" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_production_status" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_mo_done_ids" jsonb;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "factory_stage" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_status_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_stage_pushed" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_stage_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_status_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_so_status" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_production_status" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_mo_done_ids" jsonb;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "factory_stage" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_status_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "ghl_stage_pushed" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "ghl_stage_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_status_observed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_po_fingerprint_uidx" ON "katana_po_bills" USING btree ("katana_po_id","receipt_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_po_seq_uidx" ON "katana_po_bills" USING btree ("katana_po_id","receipt_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_request_id_uidx" ON "katana_po_bills" USING btree ("qbo_request_id");--> statement-breakpoint
CREATE INDEX "katana_po_bills_status_created_idx" ON "katana_po_bills" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "katana_po_bills_po_status_idx" ON "katana_po_bills" USING btree ("katana_po_id","status");--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "katana_po_bills" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;