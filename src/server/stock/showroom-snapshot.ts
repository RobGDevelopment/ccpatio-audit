/**
 * Hub Postgres persistence for Katana showroom inventory.
 * Reads are local-only (&lt;300ms). Writes come from seed / POST sync / webhooks /
 * deduplicated background triggers — never block `/embed/showroom` SSR on Katana.
 */
import { eq, sql, lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  katana_showroom_snapshot,
  katana_sync_meta,
} from "@/server/db/schema";
import {
  getKatanaInventorySnapshot,
  KATANA_HUB_SYNC_TIMEOUT_MS,
  loadKatanaInventoryWithCheckpoints,
  type KatanaInventoryRow,
  type KatanaInventorySnapshot,
  type KatanaItemType,
} from "@/server/stock/katana-inventory";
import { resolveHubSyncBadge } from "@/server/stock/hub-sync-freshness";
import {
  KATANA_SYNC_LOCK_KEY,
  resetKatanaRateLimitBucket,
} from "@/server/sre/katana-throttle";
import { runWithKatanaPriorityLane } from "@/lib/katana";

export const SHOWROOM_SYNC_META_ID = "showroom_inventory";

/** Background sync lock TTL — expired locks self-heal so a crashed worker cannot wedge forever. */
export const SHOWROOM_SYNC_LOCK_TTL_MS = 5 * 60 * 1000;

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
  const lastSyncedAt = meta?.last_synced_at?.toISOString?.() ?? null;
  const badge = resolveHubSyncBadge(lastSyncedAt);
  return {
    rows: rows.map(rowFromDb),
    lastSyncedAt,
    stale: badge.tone !== "green" || !lastSyncedAt,
    error: meta?.last_error ?? null,
    rowCount: rows.length,
  };
}

async function upsertSnapshotRows(
  rows: KatanaInventoryRow[],
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db
      .insert(katana_showroom_snapshot)
      .values(
        chunk.map((row) => ({
          variant_id: row.variantId,
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
      )
      .onConflictDoUpdate({
        target: [katana_showroom_snapshot.variant_id, katana_showroom_snapshot.location_id],
        set: {
          sku: sql`excluded.sku`,
          name: sql`excluded.name`,
          item_type: sql`excluded.item_type`,
          category: sql`excluded.category`,
          uom: sql`excluded.uom`,
          location_name: sql`excluded.location_name`,
          in_stock: sql`excluded.in_stock`,
          committed: sql`excluded.committed`,
          expected: sql`excluded.expected`,
          available: sql`excluded.available`,
          updated_at: sql`excluded.updated_at`,
        },
      });
  }
}

async function bumpSyncMeta(input: {
  lastSyncedAt?: Date;
  lastError?: string | null;
  rowCount?: number;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(katana_sync_meta)
    .values({
      id: SHOWROOM_SYNC_META_ID,
      last_synced_at: input.lastSyncedAt ?? null,
      last_error: input.lastError ?? null,
      row_count: input.rowCount ?? 0,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: katana_sync_meta.id,
      set: {
        ...(input.lastSyncedAt !== undefined
          ? { last_synced_at: input.lastSyncedAt }
          : {}),
        ...(input.lastError !== undefined ? { last_error: input.lastError } : {}),
        ...(input.rowCount !== undefined ? { row_count: input.rowCount } : {}),
        updated_at: now,
      },
    });
}

export async function persistShowroomSnapshot(
  snapshot: KatanaInventorySnapshot,
): Promise<HubShowroomSnapshot> {
  const now = new Date(snapshot.syncedAt);
  await upsertSnapshotRows(snapshot.rows, now);
  // Prune rows not touched by this sync pass.
  const db = getDb();
  await db
    .delete(katana_showroom_snapshot)
    .where(lt(katana_showroom_snapshot.updated_at, now));
  await bumpSyncMeta({
    lastSyncedAt: now,
    lastError: snapshot.error,
    rowCount: snapshot.rows.length,
  });

  return {
    rows: snapshot.rows,
    lastSyncedAt: snapshot.syncedAt,
    stale: snapshot.stale,
    error: snapshot.error,
    rowCount: snapshot.rows.length,
  };
}

/** Persist a checkpoint chunk and advance `last_synced_at` so Hub never freezes for days. */
export async function persistShowroomCheckpoint(
  rows: KatanaInventoryRow[],
  syncedAt: string = new Date().toISOString(),
): Promise<void> {
  const now = new Date(syncedAt);
  await upsertSnapshotRows(rows, now);
  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(katana_showroom_snapshot);
  await bumpSyncMeta({
    lastSyncedAt: now,
    lastError: null,
    rowCount: Number(n ?? rows.length),
  });
}

/**
 * Try to claim the background sync lock (short TTL). Returns false if another
 * worker already holds a fresh lock — so 10 showroom pageviews enqueue ONE sync.
 */
export async function tryClaimShowroomSyncLock(
  ttlMs: number = SHOWROOM_SYNC_LOCK_TTL_MS,
): Promise<boolean> {
  const db = getDb();
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets AS b (key, tokens, updated_at)
    VALUES (${KATANA_SYNC_LOCK_KEY}, 0, clock_timestamp())
    ON CONFLICT (key) DO UPDATE
      SET tokens = 0,
          updated_at = clock_timestamp()
      WHERE b.updated_at < clock_timestamp() - make_interval(secs => ${ttlSeconds})
    RETURNING 1
  `);
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] })?.rows ?? []);
  return rows.length > 0;
}

export async function releaseShowroomSyncLock(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE rate_limit_buckets
    SET tokens = 1,
        updated_at = clock_timestamp() - interval '1 hour'
    WHERE key = ${KATANA_SYNC_LOCK_KEY}
  `);
}

/**
 * Non-blocking, deduplicated background sync for showroom SSR/GET.
 * Uses Next.js `after()` so the inbound GET survives the response on serverless
 * (plain `void run()` was the `last_synced_at` black hole). Concurrent viewers
 * share one lock so Katana is not stampeded.
 */
export async function enqueueBackgroundShowroomSync(options?: {
  force?: boolean;
  priority?: boolean;
  reason?: string;
}): Promise<{ queued: boolean; reason: string }> {
  const hub = await readShowroomSnapshotFromHub();
  const badge = resolveHubSyncBadge(hub.lastSyncedAt);
  if (!options?.force && !badge.shouldQueueBackgroundSync) {
    return { queued: false, reason: "fresh" };
  }

  const claimed = await tryClaimShowroomSyncLock();
  if (!claimed) {
    return { queued: false, reason: "lock-held" };
  }

  const run = async () => {
    try {
      await refreshShowroomSnapshotFromKatana({
        force: true,
        priority: options?.priority === true,
        checkpoint: true,
      });
    } catch (err) {
      console.error(
        "[showroom-sync] background refresh failed:",
        err instanceof Error ? err.message : String(err),
        options?.reason ?? "",
      );
    } finally {
      await releaseShowroomSyncLock().catch(() => undefined);
    }
  };

  try {
    const { after } = await import("next/server");
    after(() => {
      void run();
    });
  } catch {
    // Outside a Next request context (unit tests / scripts) — best-effort.
    void run();
  }
  return { queued: true, reason: options?.reason ?? "stale" };
}

/**
 * Awaited inbound pull under the short sync lock — used by showroom Refresh POST
 * so the client receives a fresh `last_synced_at` (not a dead queue toast).
 */
export async function awaitShowroomSyncUnderLock(options?: {
  priority?: boolean;
  reason?: string;
}): Promise<
  | { ok: true; hub: HubShowroomSnapshot; claimed: boolean; reason: string }
  | { ok: false; error: string }
> {
  const claimed = await tryClaimShowroomSyncLock();
  if (!claimed) {
    const hub = await readShowroomSnapshotFromHub();
    return { ok: true, hub, claimed: false, reason: "lock-held" };
  }
  try {
    const hub = await refreshShowroomSnapshotFromKatana({
      force: true,
      priority: options?.priority !== false,
      checkpoint: true,
    });
    return {
      ok: true,
      hub,
      claimed: true,
      reason: options?.reason ?? "awaited-sync",
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Katana showroom sync failed.",
    };
  } finally {
    await releaseShowroomSyncLock().catch(() => undefined);
  }
}

/**
 * Pull live Katana (with built-in 429 backoff) and upsert Hub snapshot.
 * Single-flight so concurrent POST / webhook calls collapse.
 * When `checkpoint: true`, stock rows + telemetry land incrementally per page.
 */
export async function refreshShowroomSnapshotFromKatana(options?: {
  force?: boolean;
  priority?: boolean;
  checkpoint?: boolean;
}): Promise<HubShowroomSnapshot> {
  if (refreshInflight) return refreshInflight;
  void SYNC_CONCURRENCY;

  refreshInflight = (async () => {
    const runBody = async () => {
      if (options?.checkpoint) {
        const live = await loadKatanaInventoryWithCheckpoints({
          timeoutMs: KATANA_HUB_SYNC_TIMEOUT_MS,
          onCheckpoint: async (rows, syncedAt) => {
            await persistShowroomCheckpoint(rows, syncedAt);
          },
        });
        return await persistShowroomSnapshot(live);
      }
      const live = await getKatanaInventorySnapshot({
        force: options?.force ?? true,
        timeoutMs: KATANA_HUB_SYNC_TIMEOUT_MS,
      });
      return await persistShowroomSnapshot(live);
    };

    try {
      if (options?.priority) {
        return await runWithKatanaPriorityLane(runBody);
      }
      return await runBody();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Katana showroom sync failed.";
      await bumpSyncMeta({ lastError: message });
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

export type KatanaManualSyncResult =
  | {
      ok: true;
      message: string;
      syncedItemsCount: number;
      lastSyncedAt: string;
      durationMs: number;
      clearedKeys?: string[];
    }
  | { ok: false; error: string };

/**
 * Executive CTA: optional bucket/lock reset, then **direct awaited** inbound
 * Katana GET → Hub upsert. Never fire-and-forget on serverless (that black-holes
 * `last_synced_at`). Never mutates Katana ERP beyond the read/sync inventory path.
 * Not gated by DOWNSTREAM_MUTATIONS (inbound GET only).
 */
export async function resetBucketAndSyncKatanaNow(options?: {
  resetBucket?: boolean;
}): Promise<KatanaManualSyncResult> {
  const started = Date.now();
  try {
    let clearedKeys: string[] = [];
    if (options?.resetBucket !== false) {
      const reset = await resetKatanaRateLimitBucket();
      clearedKeys = reset.clearedKeys;
      await releaseShowroomSyncLock().catch(() => undefined);
    }
    const snap = await refreshShowroomSnapshotFromKatana({
      force: true,
      priority: true,
      checkpoint: true,
    });
    const lastSyncedAt = snap.lastSyncedAt ?? new Date().toISOString();
    return {
      ok: true,
      clearedKeys,
      syncedItemsCount: snap.rowCount,
      lastSyncedAt,
      durationMs: Date.now() - started,
      message: `Synced ${snap.rowCount} Katana inventory rows · ${lastSyncedAt}`,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not sync Katana inventory.",
    };
  }
}

/** Alias for Executive "Run Katana Sync Now" (no bucket reset). */
export async function syncKatanaInventoryNow(): Promise<KatanaManualSyncResult> {
  return resetBucketAndSyncKatanaNow({ resetBucket: false });
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
