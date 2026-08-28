-- E-commerce export flag on universal SKU hub.
ALTER TABLE "sku_mappings"
  ADD COLUMN IF NOT EXISTS "sync_to_woo" boolean NOT NULL DEFAULT false;
