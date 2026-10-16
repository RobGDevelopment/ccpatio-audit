-- 0056_pos_receipts.sql
-- Phase 14 (QBO ledger). HAND-WRITTEN. ADDITIVE ONLY: CREATE TABLE / CREATE INDEX /
-- ENABLE ROW LEVEL SECURITY. No existing object is dropped or altered. Never applied with
-- `drizzle-kit push`; apply with `drizzle-kit migrate` after review.
--
-- GAAP rule (operator-ratified): the showroom never touches QBO. QBO is written only when a
-- capital event occurs: a Clover payment successfully attached to an APPROVED quote. The QBO
-- document is always a JournalEntry (Dr clearing account, Cr "Customer Deposits" liability),
-- cash received only. No tax, no revenue recognition (Phase 15).
--
-- One row per Clover payment seen. status:
--   pending  stored, not yet decided
--   posted   the JournalEntry exists in QBO (qbo_journal_entry_id set)
--   triaged  a person must act (see ledger_triage)
--   ignored  showroom sale / non-sale; never reaches QBO
--
-- Order link: clover_order_id is stored here; the GHL quote id (quote_ref, `GHL-<opportunityId>`)
-- is injected into the QBO JournalEntry notes. customer_email is the lower-cased GHL contact
-- email used to find-or-create the QBO customer.
--
-- RLS is enabled with NO policies (deny-all for the Supabase Data API). App access is
-- POSTGRES_URL (table owner), which bypasses RLS. Same convention as
-- 0053_rls_qbo_tokens_incoming_webhooks.sql and 0054_sre_dlq_saga_buckets.sql.
-- FORCE ROW LEVEL SECURITY is NOT used. The REVOKE is guarded so databases without the
-- Supabase roles do not fail.

CREATE TABLE "pos_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" text NOT NULL,
	"clover_payment_id" text NOT NULL,
	"clover_order_id" text,
	"quote_ref" text,
	"ghl_contact_id" text,
	"customer_email" text,
	"qbo_customer_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"paid_at" timestamp with time zone,
	"txn_date" date,
	"qbo_doc_type" text DEFAULT 'JournalEntry' NOT NULL,
	"qbo_request_id" text NOT NULL,
	"qbo_journal_entry_id" text,
	"posted_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_receipts_status_check" CHECK ("pos_receipts"."status" in ('pending', 'posted', 'triaged', 'ignored')),
	CONSTRAINT "pos_receipts_amount_positive" CHECK ("pos_receipts"."amount_cents" is null or "pos_receipts"."amount_cents" > 0),
	CONSTRAINT "pos_receipts_currency_usd" CHECK ("pos_receipts"."currency" = 'USD'),
	CONSTRAINT "pos_receipts_doc_type_check" CHECK ("pos_receipts"."qbo_doc_type" = 'JournalEntry'),
	CONSTRAINT "pos_receipts_payment_id_bare" CHECK ("pos_receipts"."clover_payment_id" <> '' and "pos_receipts"."clover_payment_id" not like 'P:%'),
	CONSTRAINT "pos_receipts_quote_ref_format" CHECK ("pos_receipts"."quote_ref" is null or "pos_receipts"."quote_ref" ~ '^GHL-[A-Za-z0-9_-]+$'),
	CONSTRAINT "pos_receipts_email_lowercase" CHECK ("pos_receipts"."customer_email" is null or "pos_receipts"."customer_email" = lower("pos_receipts"."customer_email")),
	CONSTRAINT "pos_receipts_posted_complete" CHECK ("pos_receipts"."status" <> 'posted' or ("pos_receipts"."amount_cents" is not null and "pos_receipts"."quote_ref" is not null and "pos_receipts"."qbo_customer_id" is not null and "pos_receipts"."qbo_journal_entry_id" is not null and "pos_receipts"."posted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "pos_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_receipts_merchant_payment_uidx" ON "pos_receipts" USING btree ("merchant_id","clover_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_receipts_journal_entry_uidx" ON "pos_receipts" USING btree ("qbo_journal_entry_id") WHERE "pos_receipts"."qbo_journal_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "pos_receipts_status_created_idx" ON "pos_receipts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pos_receipts_quote_ref_idx" ON "pos_receipts" USING btree ("quote_ref");--> statement-breakpoint
CREATE INDEX "pos_receipts_clover_order_idx" ON "pos_receipts" USING btree ("clover_order_id");--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "pos_receipts" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
