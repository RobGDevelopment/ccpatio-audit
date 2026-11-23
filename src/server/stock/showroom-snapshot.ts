/**
 * Hub Postgres persistence for Katana showroom inventory.
 * Reads are local-only (&lt;300ms). Writes come from seed / POST sync / webhooks.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  katana_showroom_snapshot,
  katana_sync_meta,
} from "@/server/db/schema";
import {
  getKatanaInventorySnapshot,
  KATANA_HUB_SYNC_TIMEOUT_MS,
  type KatanaInventoryRow,
  type KatanaInventorySnapshot,
  type KatanaItemType,
} from "@/server/stock/katana-inventory";

export const SHOWROOM_SYNC_META_ID = "showroom_inventory";

const SYNC_CONCURRENCY = 1; // serialize full refreshes; page fetches use katanaFetch 429 backoff

let refreshInflight: Promise<HubShowroomSnapshot> | null = null;

export type HubShowroomSnapshot = {
  rows: KatanaInventoryRow[];
  lastSyncedAt: string | null;
  stale: boolean;
  error: string | null;
  rowCount: number;
};

function num(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rowFromDb(r: typeof katana_showroom_snapshot.$inferSelect): KatanaInventoryRow {
  return {
    variantId: r.variant_id,
    sku: r.sku,
    name: r.name,
    itemType: r.item_type as KatanaItemType,
    category: r.category,
    uom: r.uom,
    locationId: r.location_id && r.location_id > 0 ? r.location_id : null,
    locationName: r.location_name,
    inStock: num(r.in_stock),
    committed: num(r.committed),
    expected: num(r.expected),
    available: num(r.available),
    deleted: false,
  };
}

/** Instant Hub read — never calls Katana. */
export async function readShowroomSnapshotFromHub(): Promise<HubShowroomSnapshot> {
  const db = getDb();
  const [meta] = await db
    .select()
    .from(katana_sync_meta)
    .where(eq(katana_sync_meta.id, SHOWROOM_SYNC_META_ID))
    .limit(1);
  const rows = await db.select().from(katana_showroom_snapshot);
  return {
    rows: rows.map(rowFromDb),
    lastSyncedAt: meta?.last_synced_at?.toISOString?.() ?? null,
    stale: false,
    error: meta?.last_error ?? null,
    rowCount: rows.length,
  };
}

export async function persistShowroomSnapshot(
  snapshot: KatanaInventorySnapshot,
): Promise<HubShowroomSnapshot> {
  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.delete(katana_showroom_snapshot);
    if (snapshot.rows.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < snapshot.rows.length; i += chunkSize) {
        const chunk = snapshot.rows.slice(i, i + chunkSize);
        await tx.insert(katana_showroom_snapshot).values(
          chunk.map((row) => ({
            variant_id: row.variantId,
            // Coalesce null location to 0 so the unique index is deterministic.
            location_id: row.locationId ?? 0,
            sku: row.sku,
            name: row.name,
            item_type: row.itemType,
            category: row.category,
            uom: row.uom,
            location_name: row.locationName,
            in_stock: String(row.inStock),
            committed: String(row.committed),
            expected: String(row.expected),
            available: String(row.available),
            updated_at: now,
          })),
        );
      }
    }
    await tx
      .insert(katana_sync_meta)
      .values({
        id: SHOWROOM_SYNC_META_ID,
        last_synced_at: new Date(snapshot.syncedAt),
        last_error: snapshot.error,
        row_count: snapshot.rows.length,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: katana_sync_meta.id,
        set: {
          last_synced_at: new Date(snapshot.syncedAt),
          last_error: snapshot.error,
          row_count: snapshot.rows.length,
          updated_at: now,
        },
      });
  });

  return {
    rows: snapshot.rows,
    lastSyncedAt: snapshot.syncedAt,
    stale: snapshot.stale,
    error: snapshot.error,
    rowCount: snapshot.rows.length,
  };
}

/**
 * Pull live Katana (with built-in 429 backoff) and upsert Hub snapshot.
 * Single-flight so concurrent POST / webhook calls collapse.
 */
export async function refreshShowroomSnapshotFromKatana(options?: {
  force?: boolean;
}): Promise<HubShowroomSnapshot> {
  if (refreshInflight) return refreshInflight;
  // concurrency gate kept explicit for tests / future multi-resource fan-out
  void SYNC_CONCURRENCY;

  refreshInflight = (async () => {
    try {
      const live = await getKatanaInventorySnapshot({
        force: options?.force ?? true,
        timeoutMs: KATANA_HUB_SYNC_TIMEOUT_MS,
      });
      return await persistShowroomSnapshot(live);
    } catch (err) {
      const db = getDb();
      const message = err instanceof Error ? err.message : "Katana showroom sync failed.";
      await db
        .insert(katana_sync_meta)
        .values({
          id: SHOWROOM_SYNC_META_ID,
          last_error: message,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: katana_sync_meta.id,
          set: { last_error: message, updated_at: new Date() },
        });
      const hub = await readShowroomSnapshotFromHub();
      if (hub.rows.length > 0) {
        return { ...hub, stale: true, error: message };
      }
      throw err;
    } finally {
      refreshInflight = null;
    }
  })();

  return refreshInflight;
}

/** Ensure migration tables exist (idempotent) for seed / first deploy. */
export async function ensureShowroomSnapshotTables(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
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
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "katana_showroom_snapshot_variant_loc_uidx"
      ON "katana_showroom_snapshot" ("variant_id", "location_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "katana_showroom_snapshot_sku_idx"
      ON "katana_showroom_snapshot" ("sku")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "katana_sync_meta" (
      "id" text PRIMARY KEY DEFAULT 'showroom_inventory',
      "last_synced_at" timestamptz,
      "last_error" text,
      "row_count" integer NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    INSERT INTO "katana_sync_meta" ("id", "row_count")
    VALUES ('showroom_inventory', 0)
    ON CONFLICT ("id") DO NOTHING
  `);
}
