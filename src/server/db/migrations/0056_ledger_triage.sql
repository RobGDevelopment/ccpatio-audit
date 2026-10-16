-- 0056_ledger_triage.sql
-- Phase 14 (QBO ledger). HAND-WRITTEN. ADDITIVE ONLY: CREATE TABLE / ADD CONSTRAINT on the
-- NEW table / CREATE INDEX / ENABLE ROW LEVEL SECURITY. No existing object is dropped or
-- altered. Depends on 0056_pos_receipts (foreign key). Never applied with `drizzle-kit push`.
--
-- The human-action queue for a capital event that could not be posted. One OPEN row per
-- (receipt, reason). A paid order is never deleted: the foreign key is ON DELETE RESTRICT and
-- rows are resolved or discarded, never removed. A ledger failure is retried, not rolled back:
-- transient QBO errors (429 / 5xx / network) retry in Inngest and do NOT land here; only a
-- condition a person must fix does.
--
-- reason (a closed list, mirrored in src/server/ledger/customer-deposit.ts):
--   quote_ref_invalid        the attached quote key is not `GHL-<opportunityId>`
--   quote_not_approved       payment attached to a quote that is not approved yet
--   invalid_amount           amount is not a positive integer number of cents
--   unsupported_currency     anything other than USD
--   customer_email_missing   the GHL contact has no usable email to find-or-create the customer
--   customer_unresolved      the QBO customer could not be found or created
--   accounts_unconfigured    clearing or Customer Deposits account id is not set
--   qbo_rejected             QBO answered 400 (validation); needs a person
-- `detail` is static, secret-free text (for example the NAMES of unset settings).
--
-- RLS is enabled with NO policies (deny-all for the Supabase Data API). App access is
-- POSTGRES_URL (table owner), which bypasses RLS. FORCE ROW LEVEL SECURITY is NOT used.
-- The REVOKE is guarded so databases without the Supabase roles do not fail.

CREATE TABLE "ledger_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pos_receipt_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"clover_payment_id" text NOT NULL,
	"clover_order_id" text,
	"quote_ref" text,
	"reason" text NOT NULL,
	"detail" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_triage_reason_check" CHECK ("ledger_triage"."reason" in ('quote_ref_invalid', 'quote_not_approved', 'invalid_amount', 'unsupported_currency', 'customer_email_missing', 'customer_unresolved', 'accounts_unconfigured', 'qbo_rejected')),
	CONSTRAINT "ledger_triage_status_check" CHECK ("ledger_triage"."status" in ('open', 'resolved', 'discarded')),
	CONSTRAINT "ledger_triage_resolved_stamped" CHECK ("ledger_triage"."status" = 'open' or "ledger_triage"."resolved_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "ledger_triage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_triage" ADD CONSTRAINT "ledger_triage_pos_receipt_id_pos_receipts_id_fk" FOREIGN KEY ("pos_receipt_id") REFERENCES "public"."pos_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_triage_open_reason_uidx" ON "ledger_triage" USING btree ("pos_receipt_id","reason") WHERE "ledger_triage"."status" = 'open';--> statement-breakpoint
CREATE INDEX "ledger_triage_status_created_idx" ON "ledger_triage" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ledger_triage_receipt_idx" ON "ledger_triage" USING btree ("pos_receipt_id");--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "ledger_triage" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
