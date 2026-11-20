-- 0059_ecommerce_listings_woo_sku.sql
-- phase1-redteam-closeout: additive woo_sku column so storefront SKUs are 1:1
-- with ecommerce_listings rows while global_sku remains the Katana/canonical link.
-- ADDITIVE ONLY. Never applied with `drizzle-kit push`.
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "woo_sku" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_listings_woo_sku_active_uidx"
  ON "ecommerce_listings" ("woo_sku")
  WHERE "archived_at" IS NULL AND "woo_sku" IS NOT NULL;
