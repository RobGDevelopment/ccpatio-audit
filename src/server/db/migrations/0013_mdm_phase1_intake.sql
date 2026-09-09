-- MDM Phase 1: product_intake, channel_sync, SEO columns, RM→hub FK, bom_explosion view.

-- SEO fields on finished goods commerce catalog
ALTER TABLE "finished_goods_catalog"
  ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "finished_goods_catalog"
  ADD COLUMN IF NOT EXISTS "seo_title" text;
ALTER TABLE "finished_goods_catalog"
  ADD COLUMN IF NOT EXISTS "seo_description" text;

-- Ensure every raw-material SKU exists on the hub before FK
INSERT INTO "sku_mappings" (
  "global_sku",
  "category",
  "item_type",
  "original_name",
  "source_file",
  "is_active",
  "sync_to_woo"
)
SELECT
  r."sku",
  COALESCE(NULLIF(TRIM(r."category"), ''), 'Raw'),
  'raw_material'::"item_type",
  COALESCE(NULLIF(TRIM(r."name"), ''), r."sku"),
  'raw_materials_catalog_fk_backfill',
  true,
  false
FROM "raw_materials_catalog" r
WHERE NOT EXISTS (
  SELECT 1 FROM "sku_mappings" s WHERE s."global_sku" = r."sku"
)
ON CONFLICT ("global_sku") DO NOTHING;

ALTER TABLE "raw_materials_catalog"
  DROP CONSTRAINT IF EXISTS "raw_materials_catalog_sku_sku_mappings_global_sku_fk";
ALTER TABLE "raw_materials_catalog"
  DROP CONSTRAINT IF EXISTS "raw_materials_catalog_sku_fkey";

ALTER TABLE "raw_materials_catalog"
  ADD CONSTRAINT "raw_materials_catalog_sku_fkey"
  FOREIGN KEY ("sku") REFERENCES "sku_mappings"("global_sku")
  ON UPDATE CASCADE ON DELETE RESTRICT;

DO $$ BEGIN
  CREATE TYPE "public"."product_intake_status" AS ENUM (
    'quarantined',
    'approved',
    'rejected',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "product_intake" (
  "export_id" uuid PRIMARY KEY,
  "status" "product_intake_status" NOT NULL DEFAULT 'quarantined',
  "raw_payload" jsonb NOT NULL,
  "zod_issues" jsonb,
  "proposed_sku" varchar(120),
  "created_by" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "product_intake_status_idx"
  ON "product_intake" ("status");

DO $$ BEGIN
  CREATE TYPE "public"."channel_sync_status" AS ENUM (
    'pending',
    'success',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."channel_sync_channel" AS ENUM (
    'katana',
    'woocommerce',
    'clover'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "channel_sync" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "global_sku" text NOT NULL,
  "channel" "channel_sync_channel" NOT NULL,
  "external_id" varchar(255),
  "status" "channel_sync_status" NOT NULL DEFAULT 'pending',
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "channel_sync_global_sku_fkey"
    FOREIGN KEY ("global_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_sync_sku_channel_uidx"
  ON "channel_sync" ("global_sku", "channel");

CREATE INDEX IF NOT EXISTS "channel_sync_status_idx"
  ON "channel_sync" ("status");

-- Recursive BOM explosion view (IT / debug). App queries use parameterized CTE in bom.ts.
CREATE OR REPLACE VIEW "bom_explosion" AS
WITH RECURSIVE explosion AS (
  SELECT
    pb."parent_sku" AS "root_sku",
    pb."parent_sku",
    pb."child_sku",
    pb."quantity",
    pb."scrap_factor",
    pb."unit_of_measure",
    1 AS "depth",
    ARRAY[pb."parent_sku", pb."child_sku"]::text[] AS "path"
  FROM "product_bom" pb
  UNION ALL
  SELECT
    e."root_sku",
    pb."parent_sku",
    pb."child_sku",
    pb."quantity",
    pb."scrap_factor",
    pb."unit_of_measure",
    e."depth" + 1,
    e."path" || pb."child_sku"
  FROM "product_bom" pb
  INNER JOIN explosion e ON pb."parent_sku" = e."child_sku"
  WHERE e."depth" < 12
    AND NOT (pb."child_sku" = ANY (e."path"))
)
SELECT * FROM explosion;
