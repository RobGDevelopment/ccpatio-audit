-- Enable Supabase Realtime for raw materials catalog (bidirectional PIM sync).

ALTER TABLE "raw_materials_catalog" REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE raw_materials_catalog;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
