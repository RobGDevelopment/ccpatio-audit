-- sku_aliases + ON UPDATE CASCADE for hub FK renames (finished-good SKU migration).

CREATE TABLE IF NOT EXISTS finished_goods_catalog (
  global_sku text PRIMARY KEY,
  msrp text,
  length text,
  depth text,
  height text,
  arm_height text,
  sit_height text,
  description text,
  image_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sku_aliases (
  alias_sku text PRIMARY KEY,
  canonical_sku text NOT NULL REFERENCES sku_mappings(global_sku) ON UPDATE CASCADE ON DELETE CASCADE,
  reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_aliases_canonical_sku_idx ON sku_aliases (canonical_sku);

-- Ensure finished_goods_catalog FK cascades PK renames on sku_mappings.
ALTER TABLE finished_goods_catalog
  DROP CONSTRAINT IF EXISTS finished_goods_catalog_global_sku_sku_mappings_global_sku_fk;

ALTER TABLE finished_goods_catalog
  DROP CONSTRAINT IF EXISTS finished_goods_catalog_global_sku_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finished_goods_catalog_global_sku_fkey'
      AND confupdtype = 'c'
  ) THEN
    ALTER TABLE finished_goods_catalog
      ADD CONSTRAINT finished_goods_catalog_global_sku_fkey
      FOREIGN KEY (global_sku)
      REFERENCES sku_mappings(global_sku)
      ON UPDATE CASCADE
      ON DELETE CASCADE;
  END IF;
END $$;
