-- MDM Phase 2: OCC on product_intake, reject reason, Clover export flag.

ALTER TABLE "product_intake"
  ADD COLUMN IF NOT EXISTS "reject_reason" text;
ALTER TABLE "product_intake"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

ALTER TABLE "sku_mappings"
  ADD COLUMN IF NOT EXISTS "sync_to_clover" boolean NOT NULL DEFAULT false;
