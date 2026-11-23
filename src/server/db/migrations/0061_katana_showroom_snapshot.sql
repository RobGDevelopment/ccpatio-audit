-- 0061_katana_showroom_snapshot.sql
-- phase1-final-10gate-greenlight: Hub-backed Katana inventory snapshot for
-- GHL Current Inventory. ADDITIVE ONLY. Never applied with `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "katana_showroom_snapshot" (
  "variant_id" integer NOT NULL,
  "location_id" integer,
  "sku" text NOT NULL,
  "name" text NOT NULL,
  "item_type" text NOT NULL,
  "category" text,
  "uom" text,
  "location_name" text NOT NULL DEFAULT 'All Locations',
  "in_stock" numeric(14, 4) NOT NULL DEFAULT '0',
  "committed" numeric(14, 4) NOT NULL DEFAULT '0',
  "expected" numeric(14, 4) NOT NULL DEFAULT '0',
  "available" numeric(14, 4) NOT NULL DEFAULT '0',
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "katana_showroom_snapshot_variant_loc_uidx"
  ON "katana_showroom_snapshot" ("variant_id", "location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "katana_showroom_snapshot_sku_idx"
  ON "katana_showroom_snapshot" ("sku");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "katana_sync_meta" (
  "id" text PRIMARY KEY DEFAULT 'showroom_inventory',
  "last_synced_at" timestamptz,
  "last_error" text,
  "row_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
INSERT INTO "katana_sync_meta" ("id", "row_count")
VALUES ('showroom_inventory', 0)
ON CONFLICT ("id") DO NOTHING;
