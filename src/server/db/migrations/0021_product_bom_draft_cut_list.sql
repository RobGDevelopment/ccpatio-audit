-- Phase 1.5: draft cut_list jsonb parity with live product_bom.
-- Binding: docs/FACTORY_BOM_KATANA_UX_PLAN.md

ALTER TABLE "product_bom_draft"
  ADD COLUMN IF NOT EXISTS "cut_list" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN "product_bom_draft"."cut_list" IS
  'Structured CutLine[] for Factory Cut Cards; notes is manager text only';
