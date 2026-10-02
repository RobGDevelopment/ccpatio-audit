-- 0025_rm_item_type_backfill.sql
-- PR-OPS-A1: Force RM-* hub SKUs to raw_material and clear stale Katana
-- product IDs so the unified writer can POST /materials on resync.

UPDATE "sku_mappings"
SET
  "item_type" = 'raw_material',
  "katana_variant_id" = NULL,
  "katana_material_id" = NULL,
  "updated_at" = NOW(),
  "version" = "version" + 1
WHERE "global_sku" ILIKE 'RM-%'
  AND (
    "item_type" <> 'raw_material'
    OR ("katana_variant_id" IS NOT NULL AND "katana_material_id" IS NULL)
  );
