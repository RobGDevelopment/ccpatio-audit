-- Additive only: finish_intake + product media/video certification columns.
-- Zero drops. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "finish_intake" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "category_folder" text NOT NULL,
  "original_filename" text NOT NULL,
  "raw_reference_url" text,
  "texture_2048_url" text,
  "thumb_512_url" text,
  "source_width" integer,
  "source_height" integer,
  "crop_x" integer,
  "crop_y" integer,
  "crop_side_px" integer,
  "crop_x_norm" numeric(12, 8),
  "crop_y_norm" numeric(12, 8),
  "crop_side_norm" numeric(12, 8),
  "material_class" text,
  "display_name" text,
  "vendor_sku" text,
  "material_description" text,
  "pattern_mode" text,
  "repeat_w_in" numeric(10, 3),
  "repeat_h_in" numeric(10, 3),
  "proposed_sku" text,
  "canonical_sku" text,
  "status" text NOT NULL DEFAULT 'pending',
  "texture_sha256" text,
  "raw_source_file" text,
  "certified_at" timestamptz,
  "certified_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "finish_intake_source_key_uidx" ON "finish_intake" ("source_key");
CREATE INDEX IF NOT EXISTS "finish_intake_status_idx" ON "finish_intake" ("status");
CREATE INDEX IF NOT EXISTS "finish_intake_canonical_sku_idx" ON "finish_intake" ("canonical_sku");

ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "gallery_image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "product_video_url" text;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "product_video_external_url" text;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "media_certified_at" timestamptz;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "media_certified_by" text;
