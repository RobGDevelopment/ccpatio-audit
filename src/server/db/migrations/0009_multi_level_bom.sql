-- Phase 3: Multi-level BOM + item_operations routings.
-- Renames preserve existing BOM links via ALTER TABLE … RENAME COLUMN.

-- Drop legacy FK to finished_goods_catalog (parents may be sub_assemblies).
ALTER TABLE "product_bom" DROP CONSTRAINT IF EXISTS "product_bom_finished_good_sku_fkey";
ALTER TABLE "product_bom" DROP CONSTRAINT IF EXISTS "product_bom_finished_good_sku_finished_goods_catalog_global_sku_fk";

ALTER TABLE "product_bom" RENAME COLUMN "finished_good_sku" TO "parent_sku";
ALTER TABLE "product_bom" RENAME COLUMN "component_sku" TO "child_sku";

ALTER TABLE "product_bom"
  ADD COLUMN IF NOT EXISTS "scrap_factor" numeric(12, 4) DEFAULT 1.0000 NOT NULL;

-- Drop orphan lines that cannot resolve against sku_mappings hub.
DELETE FROM "product_bom" pb
WHERE NOT EXISTS (
  SELECT 1 FROM "sku_mappings" sm WHERE sm."global_sku" = pb."parent_sku"
)
OR NOT EXISTS (
  SELECT 1 FROM "sku_mappings" sm WHERE sm."global_sku" = pb."child_sku"
);

-- Deduplicate before unique (parent, child).
DELETE FROM "product_bom" a
USING "product_bom" b
WHERE a."id"::text > b."id"::text
  AND a."parent_sku" = b."parent_sku"
  AND a."child_sku" = b."child_sku";

ALTER TABLE "product_bom"
  ADD CONSTRAINT "product_bom_parent_sku_fkey"
  FOREIGN KEY ("parent_sku") REFERENCES "sku_mappings"("global_sku")
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "product_bom"
  ADD CONSTRAINT "product_bom_child_sku_fkey"
  FOREIGN KEY ("child_sku") REFERENCES "sku_mappings"("global_sku")
  ON UPDATE CASCADE ON DELETE RESTRICT;

DROP INDEX IF EXISTS "product_bom_finished_good_sku_idx";
DROP INDEX IF EXISTS "product_bom_component_sku_idx";

CREATE INDEX IF NOT EXISTS "product_bom_parent_sku_idx"
  ON "product_bom" ("parent_sku");

CREATE INDEX IF NOT EXISTS "product_bom_child_sku_idx"
  ON "product_bom" ("child_sku");

CREATE UNIQUE INDEX IF NOT EXISTS "product_bom_parent_child_uidx"
  ON "product_bom" ("parent_sku", "child_sku");

CREATE TABLE IF NOT EXISTS "item_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_sku" text NOT NULL,
  "work_center" varchar(120) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 10,
  "setup_time_mins" numeric(12, 4),
  "run_time_mins" numeric(12, 4),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "item_operations_item_sku_fkey"
    FOREIGN KEY ("item_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "item_operations_item_sku_idx"
  ON "item_operations" ("item_sku");
