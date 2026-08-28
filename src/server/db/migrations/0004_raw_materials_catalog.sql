-- Phase 2: Raw materials catalog for BOM linkage.

CREATE TABLE IF NOT EXISTS raw_materials_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  unit_of_measure text NOT NULL DEFAULT 'ea',
  cost_per_unit numeric(12, 4),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_materials_catalog_category_idx
  ON raw_materials_catalog (category);

CREATE INDEX IF NOT EXISTS raw_materials_catalog_name_idx
  ON raw_materials_catalog (name);
