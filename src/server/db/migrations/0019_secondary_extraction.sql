-- Secondary Extraction: physics factor library + draft-only recipe estimates.
-- Binding: drafts quarantine CAD; Approve is the only gate to live adjacency.

ALTER TYPE "recipe_source" ADD VALUE IF NOT EXISTS 'secondary_extract';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "material_physics_factors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "material_sku" text NOT NULL,
  "profile_code" text NOT NULL DEFAULT '',
  "weight_plf" numeric(12, 4),
  "density_pcf" numeric(12, 4),
  "oz_per_yd2" numeric(12, 4),
  "fabric_width_in" numeric(12, 4),
  "perimeter_in" numeric(12, 4),
  "coverage_sqft_per_lb" numeric(12, 4),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "material_physics_factors_material_sku_fkey"
    FOREIGN KEY ("material_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "material_physics_factors_sku_profile_uidx"
  ON "material_physics_factors" ("material_sku", "profile_code");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "recipe_estimates_draft" (
  "root_sku" text PRIMARY KEY,
  "est_weight_lbs" numeric(12, 4),
  "weight_breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "est_dim_weight_lbs" numeric(12, 4),
  "carton_lwh_in" jsonb DEFAULT NULL,
  "packaging_bom" jsonb DEFAULT NULL,
  "est_labor_minutes" numeric(12, 4),
  "labor_breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "est_packaging_cost" numeric(12, 4),
  "overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" "recipe_review_status" NOT NULL DEFAULT 'draft_pending_review',
  "source" "recipe_source" NOT NULL DEFAULT 'secondary_extract',
  "calc_version" text NOT NULL DEFAULT '1',
  "inputs_hash" text,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "recipe_estimates_draft_root_sku_fkey"
    FOREIGN KEY ("root_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);
--> statement-breakpoint

-- Seed hub SKUs for physics + packaging placeholders (no invented Katana ids).
INSERT INTO "sku_mappings" (
  "global_sku", "category", "item_type", "original_name", "source_file",
  "is_active", "uom_consume", "uom_purchase"
)
VALUES
  ('RM-MET-2X2-TUBING', 'Metal', 'raw_material', '2x2 aluminum tubing (16ga)', '0019_secondary_extraction', true, 'ft', 'ft'),
  ('RM-RAW-FOAM', 'Foam', 'raw_material', 'Seating foam (HD)', '0019_secondary_extraction', true, 'bdft', 'bdft'),
  ('RM-FAB-GENERIC', 'Fabric', 'raw_material', 'Fabric (generic placeholder)', '0019_secondary_extraction', true, 'yd', 'yd'),
  ('RM-PWD-GENERIC', 'Powder', 'raw_material', 'Powder coat (generic placeholder)', '0019_secondary_extraction', true, 'lb', 'lb'),
  ('RM-PKG-CORRUGATE', 'Packaging', 'raw_material', 'Corrugate wrap (estimate)', '0019_secondary_extraction', true, 'sqft', 'sqft'),
  ('RM-PKG-EDGE-BOARD', 'Packaging', 'raw_material', 'Edge protector board', '0019_secondary_extraction', true, 'ft', 'ft'),
  ('RM-PKG-STRETCH', 'Packaging', 'raw_material', 'Stretch wrap', '0019_secondary_extraction', true, 'ft', 'ft')
ON CONFLICT ("global_sku") DO UPDATE SET
  "category" = EXCLUDED."category",
  "original_name" = COALESCE("sku_mappings"."original_name", EXCLUDED."original_name"),
  "uom_consume" = COALESCE("sku_mappings"."uom_consume", EXCLUDED."uom_consume");
--> statement-breakpoint

INSERT INTO "raw_materials_catalog" ("sku", "name", "category", "unit_of_measure")
VALUES
  ('RM-MET-2X2-TUBING', '2x2 aluminum tubing (16ga)', 'Metal', 'ft'),
  ('RM-RAW-FOAM', 'Seating foam (HD)', 'Foam', 'bdft'),
  ('RM-FAB-GENERIC', 'Fabric (generic placeholder)', 'Fabric', 'yd'),
  ('RM-PWD-GENERIC', 'Powder coat (generic placeholder)', 'Powder', 'lb'),
  ('RM-PKG-CORRUGATE', 'Corrugate wrap (estimate)', 'Packaging', 'sqft'),
  ('RM-PKG-EDGE-BOARD', 'Edge protector board', 'Packaging', 'ft'),
  ('RM-PKG-STRETCH', 'Stretch wrap', 'Packaging', 'ft')
ON CONFLICT ("sku") DO NOTHING;
--> statement-breakpoint

INSERT INTO "material_physics_factors" (
  "material_sku", "profile_code", "weight_plf", "density_pcf", "oz_per_yd2",
  "fabric_width_in", "perimeter_in", "coverage_sqft_per_lb", "notes"
)
VALUES
  ('RM-MET-2X2-TUBING', 'SQ2-16', 0.9100, NULL, NULL, NULL, 8.0000, NULL, '2x2x16ga Al approx.'),
  ('RM-RAW-FOAM', '', NULL, 1.8000, NULL, NULL, NULL, NULL, 'HD seating foam'),
  ('RM-FAB-GENERIC', '', NULL, NULL, 11.5000, 54.0000, NULL, NULL, 'Generic outdoor fabric'),
  ('RM-PWD-GENERIC', '', NULL, NULL, NULL, NULL, NULL, 4.0000, 'Powder coverage')
ON CONFLICT ("material_sku", "profile_code") DO UPDATE SET
  "weight_plf" = EXCLUDED."weight_plf",
  "density_pcf" = EXCLUDED."density_pcf",
  "oz_per_yd2" = EXCLUDED."oz_per_yd2",
  "fabric_width_in" = EXCLUDED."fabric_width_in",
  "perimeter_in" = EXCLUDED."perimeter_in",
  "coverage_sqft_per_lb" = EXCLUDED."coverage_sqft_per_lb",
  "notes" = EXCLUDED."notes",
  "updated_at" = now();
--> statement-breakpoint

ALTER TABLE "material_physics_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_estimates_draft" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "material_physics_factors" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "recipe_estimates_draft" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
