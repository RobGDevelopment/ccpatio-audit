-- Additive provenance columns for high-rez finish textures (never drops / never rewrites URLs).
ALTER TABLE "ecommerce_finish_assets" ADD COLUMN IF NOT EXISTS "texture_sha256" text;
ALTER TABLE "ecommerce_finish_assets" ADD COLUMN IF NOT EXISTS "source_type" text;
ALTER TABLE "ecommerce_finish_assets" ADD COLUMN IF NOT EXISTS "source_filename" text;
ALTER TABLE "ecommerce_finish_assets" ADD COLUMN IF NOT EXISTS "texture_width_px" integer;
ALTER TABLE "ecommerce_finish_assets" ADD COLUMN IF NOT EXISTS "texture_height_px" integer;
