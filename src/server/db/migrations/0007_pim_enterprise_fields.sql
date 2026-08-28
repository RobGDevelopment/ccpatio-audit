-- Priority 3: enterprise PIM fields + audit trail for multi-operator dictionary.
ALTER TABLE "finished_goods_catalog"
  ADD COLUMN IF NOT EXISTS "weight" text,
  ADD COLUMN IF NOT EXISTS "cost" text,
  ADD COLUMN IF NOT EXISTS "qbo_item_code" text,
  ADD COLUMN IF NOT EXISTS "updated_by" text;

ALTER TABLE "sku_mappings"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" text;

-- Realtime: full row payloads on UPDATE (dashboard may still need Publication toggle).
ALTER TABLE "finished_goods_catalog" REPLICA IDENTITY FULL;
ALTER TABLE "sku_mappings" REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE finished_goods_catalog;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sku_mappings;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
