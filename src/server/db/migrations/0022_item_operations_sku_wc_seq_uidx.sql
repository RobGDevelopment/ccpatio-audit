-- PR-C Phase 2d: unique identity for live ops so Approve can UPSERT times.
-- Deduplicate keeping the newest row per (item_sku, work_center, sequence).

DELETE FROM "item_operations" a
USING "item_operations" b
WHERE a.ctid < b.ctid
  AND a."item_sku" = b."item_sku"
  AND a."work_center" = b."work_center"
  AND a."sequence" = b."sequence";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "item_operations_sku_wc_seq_uidx"
  ON "item_operations" ("item_sku", "work_center", "sequence");
