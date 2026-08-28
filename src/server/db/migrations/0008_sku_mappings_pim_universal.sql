-- Phase 1: universal PIM columns on sku_mappings (additive only).
-- Does NOT drop finished_goods_catalog dimension columns.

DO $$ BEGIN
  CREATE TYPE item_type AS ENUM (
    'raw_material',
    'sub_assembly',
    'finished_good',
    'service'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "sku_mappings"
  ADD COLUMN IF NOT EXISTS "item_type" item_type,
  ADD COLUMN IF NOT EXISTS "uom_purchase" text,
  ADD COLUMN IF NOT EXISTS "uom_consume" text,
  ADD COLUMN IF NOT EXISTS "base_cost" numeric(12, 4),
  ADD COLUMN IF NOT EXISTS "qbo_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;

-- Deterministic backfill for item_type (nullable → typed).
UPDATE "sku_mappings" sm
SET "item_type" = CASE
  WHEN lower(trim(sm.category)) IN (
    'finished good',
    'furniture',
    'firepit',
    'shade'
  ) THEN 'finished_good'::item_type
  WHEN lower(trim(sm.category)) = 'sub-assembly'
    OR sm.global_sku ILIKE 'SUB-%' THEN 'sub_assembly'::item_type
  ELSE 'raw_material'::item_type
END
WHERE sm.item_type IS NULL;

-- Default any remaining nulls, then enforce NOT NULL.
UPDATE "sku_mappings"
SET "item_type" = 'raw_material'::item_type
WHERE "item_type" IS NULL;

ALTER TABLE "sku_mappings"
  ALTER COLUMN "item_type" SET DEFAULT 'raw_material'::item_type,
  ALTER COLUMN "item_type" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_sku_mappings_item_type"
  ON "sku_mappings" ("item_type");

CREATE INDEX IF NOT EXISTS "idx_sku_mappings_category"
  ON "sku_mappings" ("category");

CREATE INDEX IF NOT EXISTS "idx_sku_mappings_attributes"
  ON "sku_mappings" USING gin ("attributes");
