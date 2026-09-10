-- Cut-list notes on live product_bom + sketchup_geometry recipe source.
-- Binding: SKP Cutlist Pipeline North Star (BOM_BRV-CLB-034034).

ALTER TYPE "recipe_source" ADD VALUE IF NOT EXISTS 'sketchup_geometry';
--> statement-breakpoint

ALTER TABLE "product_bom"
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

ALTER TABLE "product_bom"
  ADD COLUMN IF NOT EXISTS "cut_list" jsonb NOT NULL DEFAULT '[]'::jsonb;
