-- GHL Produce Factory Order intake. Human triage maps FIN-* / FAB-* before Katana.

DO $$ BEGIN
  CREATE TYPE "public"."order_intake_status" AS ENUM (
    'received',
    'approved',
    'pushed',
    'failed',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "order_intake" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ghl_opportunity_id" text NOT NULL UNIQUE,
  "status" "order_intake_status" NOT NULL DEFAULT 'received',
  "raw_payload" jsonb NOT NULL,
  "zod_issues" jsonb,
  "contact_name" text,
  "contact_email" text,
  "stage_name" text,
  "mapped_lines" jsonb,
  "katana_customer_id" integer,
  "katana_sales_order_id" integer,
  "katana_order_no" text,
  "katana_mo_ids" jsonb,
  "hold_relief" jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "order_intake_status_idx"
  ON "order_intake" ("status");

ALTER TABLE "order_intake" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "order_intake" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
