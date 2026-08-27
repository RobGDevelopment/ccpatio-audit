-- PIM "Not Applicable" overrides for finished-good health validation
ALTER TABLE "finished_goods_catalog"
ADD COLUMN IF NOT EXISTS "na_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;
