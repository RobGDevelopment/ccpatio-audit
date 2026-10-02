-- 0024_hub_tables_rls_lockdown.sql
-- PR-T2.2: Enable RLS + revoke Data API roles on MDM hub tables.
-- App access is via POSTGRES_URL (service / direct connection); anon/authenticated
-- must not read or mutate these tables through the Supabase Data API.

ALTER TABLE "sku_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_bom" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_intake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_sync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finished_goods_catalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_materials_catalog" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "sku_mappings" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "product_bom" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "item_operations" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "product_intake" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "channel_sync" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "finished_goods_catalog" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "raw_materials_catalog" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
