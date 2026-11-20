-- 0060_ecommerce_finish_assets_and_3d.sql
-- phase 3d-glb-and-hires-swatch-studio: high-res swatch registry (FAB/PWD/DEC) and
-- per-listing native .glb/.usdz slots. ADDITIVE ONLY. Never applied with `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "ecommerce_finish_assets" (
  "sku" text PRIMARY KEY,
  "finish_category" text NOT NULL CHECK ("finish_category" IN ('fabric','powder','dekton')),
  "display_name" text NOT NULL,
  "hex_code" text,
  "swatch_thumb_url" text,
  "texture_2k_url" text,
  "normal_map_url" text,
  "roughness_map_url" text,
  "sample_width_in" numeric(10,3),
  "sample_height_in" numeric(10,3),
  "pattern_repeat_w_in" numeric(10,3),
  "pattern_repeat_h_in" numeric(10,3),
  "quality_status" text NOT NULL DEFAULT 'placeholder_lowres'
    CHECK ("quality_status" IN ('placeholder_lowres','photoshoot_verified')),
  "uploaded_by" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_glb_url" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_usdz_url" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_poster_url" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_material_slots" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_file_size" integer;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_uploaded_by" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "model_3d_updated_at" timestamptz;
