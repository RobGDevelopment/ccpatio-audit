-- Phase 1: Bill of Materials relational engine.

CREATE TABLE IF NOT EXISTS product_bom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_good_sku text NOT NULL,
  component_sku text NOT NULL,
  quantity numeric(12, 4) NOT NULL,
  unit_of_measure text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT product_bom_finished_good_sku_fkey
    FOREIGN KEY (finished_good_sku)
    REFERENCES finished_goods_catalog(global_sku)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_bom_finished_good_sku_idx
  ON product_bom (finished_good_sku);

CREATE INDEX IF NOT EXISTS product_bom_component_sku_idx
  ON product_bom (component_sku);
