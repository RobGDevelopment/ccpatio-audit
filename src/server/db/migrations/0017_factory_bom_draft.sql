-- Factory BOM drafts: heuristic recipes stay off live product_bom until Approve.
-- Also mints RM-PWD-GENERIC as an MTO powder placeholder (no invented Katana ids).

DO $$ BEGIN
  CREATE TYPE "public"."recipe_review_status" AS ENUM (
    'draft_pending_review',
    'edited',
    'factory_approved'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."recipe_source" AS ENUM (
    'heuristic',
    'manager',
    'katana_import'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "product_bom_draft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_sku" text NOT NULL,
  "child_sku" text NOT NULL,
  "quantity" numeric(12, 4) NOT NULL,
  "scrap_factor" numeric(12, 4) NOT NULL DEFAULT 1.0000,
  "unit_of_measure" text NOT NULL,
  "status" "recipe_review_status" NOT NULL DEFAULT 'draft_pending_review',
  "source" "recipe_source" NOT NULL DEFAULT 'heuristic',
  "notes" text,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_bom_draft_parent_sku_fkey"
    FOREIGN KEY ("parent_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "product_bom_draft_child_sku_fkey"
    FOREIGN KEY ("child_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_bom_draft_parent_child_uidx"
  ON "product_bom_draft" ("parent_sku", "child_sku");
CREATE INDEX IF NOT EXISTS "product_bom_draft_parent_sku_idx"
  ON "product_bom_draft" ("parent_sku");
CREATE INDEX IF NOT EXISTS "product_bom_draft_status_idx"
  ON "product_bom_draft" ("status");

CREATE TABLE IF NOT EXISTS "item_operations_draft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_sku" text NOT NULL,
  "work_center" varchar(120) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 10,
  "setup_time_mins" numeric(12, 4),
  "run_time_mins" numeric(12, 4),
  "status" "recipe_review_status" NOT NULL DEFAULT 'draft_pending_review',
  "source" "recipe_source" NOT NULL DEFAULT 'heuristic',
  "notes" text,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "item_operations_draft_item_sku_fkey"
    FOREIGN KEY ("item_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "item_operations_draft_item_sku_idx"
  ON "item_operations_draft" ("item_sku");

-- Hub-only powder placeholder. Katana ids stay null until catalog publish.
INSERT INTO "sku_mappings" (
  "global_sku",
  "category",
  "item_type",
  "original_name",
  "source_file",
  "is_active",
  "uom_consume",
  "uom_purchase"
)
VALUES (
  'RM-PWD-GENERIC',
  'Powder',
  'raw_material',
  'Powder coat (generic placeholder)',
  '0017_factory_bom_draft',
  true,
  'lb',
  'lb'
)
ON CONFLICT ("global_sku") DO UPDATE SET
  "category" = EXCLUDED."category",
  "original_name" = EXCLUDED."original_name",
  "uom_consume" = COALESCE("sku_mappings"."uom_consume", EXCLUDED."uom_consume");

INSERT INTO "raw_materials_catalog" (
  "sku",
  "name",
  "category",
  "unit_of_measure"
)
VALUES (
  'RM-PWD-GENERIC',
  'Powder coat (generic placeholder)',
  'Powder',
  'lb'
)
ON CONFLICT ("sku") DO NOTHING;

ALTER TABLE "product_bom_draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_operations_draft" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "product_bom_draft" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "item_operations_draft" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
