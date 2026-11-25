import {
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { GHL_EMBED_PRINCIPAL_EMAIL, getPimSession, type PimSession } from "@/lib/pim-audit";
import type { StockRow } from "@/lib/stock-display";
import { getSupabaseUrl } from "@/lib/supabase-env";
import { getDb } from "@/server/db/client";
import { finished_goods_catalog, product_assets } from "@/server/db/schema";
import {
  listCatalogCategoryItems,
  listStockCollections,
  searchKatanaStock,
  type StockCollectionResult,
  type StockSearchResult,
} from "@/server/stock/search-katana-stock";
import {
  matchesTypeFilter,
  type KatanaInventoryRow,
} from "@/server/stock/katana-inventory";
import {
  enqueueBackgroundShowroomSync,
  readShowroomSnapshotFromHub,
} from "@/server/stock/showroom-snapshot";
import {
  resolveHubSyncBadge,
  sanitizeShowroomSyncWarning,
  type HubSyncBadge,
} from "@/server/stock/hub-sync-freshness";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { inventory_holds } from "@/server/db/schema";
import { displayStockUom } from "@/lib/hold-quantity";
import {
  projectShowroomSalesView,
  type ActiveHoldInput,
  type ProjectShowroomSalesInput,
  type SalesStockCard,
  type ShowroomSalesTab,
} from "@/server/showroom/sales-projection";

export async function resolveStockSession(embedToken?: string | null): Promise<PimSession | null> {
  const session = await getPimSession();
  if (session) return session;
  if (await verifyEmbedSessionToken(embedToken, getGhlEmbedSecret())) {
    return { email: GHL_EMBED_PRINCIPAL_EMAIL, name: "GHL Embed" };
  }
  return null;
}

/** Katana category_name shown as a live-stock tab. */
export type ShowroomStockFilter = string;

export type ShowroomCategoryResult =
  | { ok: true; items: { category: string }[] }
  | { ok: false; error: string };

function productAssetPublicUrl(storagePath: string): string | null {
  const path = storagePath.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getSupabaseUrl()?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/product-images/${path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
}

/**
 * Cross-fill blank imageUrl from finished_goods_catalog, then product_assets.
 * ZERO ecommerce_listings coupling — retail Tenjam/Umbrella/Kindle photos only.
 */
async function overlayPimImages(rows: StockRow[]): Promise<StockRow[]> {
  if (rows.length === 0) return rows;
  const db = getDb();
  const images = await db
    .select({
      sku: finished_goods_catalog.global_sku,
      imageUrl: finished_goods_catalog.image_url,
    })
    .from(finished_goods_catalog);
  const bySku = new Map<string, string>();
  for (const row of images) {
    const url = row.imageUrl?.trim();
    if (url) bySku.set(row.sku.toUpperCase(), url);
  }

  const missing = [
    ...new Set(
      rows
        .filter((row) => !(row.imageUrl?.trim() || bySku.get(row.sku.toUpperCase())))
        .map((row) => row.sku.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (missing.length > 0) {
    const assets = await db
      .select({
        sku: product_assets.global_sku,
        storagePath: product_assets.storage_path,
      })
      .from(product_assets)
      .where(
        and(
          inArray(sql<string>`upper(${product_assets.global_sku})`, missing),
          eq(product_assets.kind, "primary_image"),
          eq(product_assets.is_current, true),
        ),
      );
    for (const asset of assets) {
      const key = asset.sku.trim().toUpperCase();
      if (bySku.has(key)) continue;
      const url = productAssetPublicUrl(asset.storagePath);
      if (url) bySku.set(key, url);
    }
  }

  if (bySku.size === 0) return rows;
  return rows.map((row) => ({
    ...row,
    imageUrl: row.imageUrl?.trim() || bySku.get(row.sku.toUpperCase()) || row.imageUrl,
  }));
}

export async function listShowroomCategoryItems(embedToken?: string | null): Promise<ShowroomCategoryResult> {
  const session = await resolveStockSession(embedToken);
  if (!session) return { ok: false, error: "Sign in to view live stock." };
  try {
    return { ok: true, items: await listCatalogCategoryItems() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read Katana categories.";
    return { ok: false, error: message };
  }
}

export async function listShowroomCollections(
  filter: ShowroomStockFilter,
  embedToken?: string | null,
): Promise<StockCollectionResult> {
  const session = await resolveStockSession(embedToken);
  if (!session) return { ok: false, error: "Sign in to view live stock." };
  return listStockCollections({ category: filter });
}

export async function searchShowroomStock(input: {
  query?: string;
  filter?: ShowroomStockFilter;
  collection?: string;
  embedToken?: string | null;
}): Promise<StockSearchResult> {
  const session = await resolveStockSession(input.embedToken);
  if (!session) return { ok: false, error: "Sign in to view live stock." };

  const result = await searchKatanaStock({
    query: input.query,
    collection: input.collection,
    category: input.filter,
  });
  if (!result.ok) return result;
  return { ok: true, rows: await overlayPimImages(result.rows) };
}

export type OpsInventoryResult =
  | {
      ok: true;
      rows: StockRow[];
      syncedAt: string;
      stale: boolean;
      warning: string | null;
    }
  | { ok: false; error: string; syncedAt?: string };

function toStockRow(row: KatanaInventoryRow): StockRow {
  return {
    variantId: row.variantId,
    sku: row.sku,
    name: row.name,
    variantLabel: null,
    inStock: row.inStock,
    committed: row.committed,
    expected: row.expected,
    available: row.available,
    uom: displayStockUom(row.sku, row.uom),
    imageUrl: null,
    locationName: row.locationName,
    itemType: row.itemType,
    category: row.category,
  };
}

/**
 * Full inventory for the GHL Current Inventory tab.
 * Default: Hub Postgres snapshot only (instant). `force` refreshes from Katana
 * into Hub then returns the new snapshot — never blocks SSR on live Katana.
 */
export async function loadOpsKatanaInventory(input?: {
  force?: boolean;
  embedToken?: string | null;
  typeFilter?: "all" | "finished" | "fabrics_powders" | "subassemblies_materials";
}): Promise<OpsInventoryResult> {
  const session = await resolveStockSession(input?.embedToken);
  if (!session) return { ok: false, error: "Sign in to view live stock." };
  try {
    // `force` enqueues a non-blocking sync and still returns Hub cache immediately
    // so ops UI never blocks on the shared Katana bucket.
    if (input?.force) {
      await enqueueBackgroundShowroomSync({
        force: true,
        priority: true,
        reason: "ops-force-refresh",
      });
    }
    const snapshot = await readShowroomSnapshotFromHub();
    const badge = resolveHubSyncBadge(snapshot.lastSyncedAt);
    const filter = input?.typeFilter ?? "all";
    const rows = snapshot.rows
      .filter((row) => matchesTypeFilter(row.itemType, filter))
      .map(toStockRow);
    return {
      ok: true,
      rows: await overlayPimImages(rows),
      syncedAt: snapshot.lastSyncedAt ?? new Date(0).toISOString(),
      stale: badge.tone !== "green",
      warning: sanitizeShowroomSyncWarning(snapshot.error),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Hub inventory snapshot.",
    };
  }
}

export type SalesInventoryResult =
  | {
      ok: true;
      cards: SalesStockCard[];
      rows: StockRow[];
      syncedAt: string;
      stale: boolean;
      warning: string | null;
      elapsedMs: number;
      badge: HubSyncBadge;
      backgroundSyncQueued: boolean;
    }
  | { ok: false; error: string; elapsedMs?: number };

async function loadActiveHoldsForSales(): Promise<ActiveHoldInput[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      variantId: inventory_holds.katana_variant_id,
      sku: inventory_holds.sku,
      qty: inventory_holds.qty,
      salesperson: inventory_holds.ghl_user_name,
      opportunityName: inventory_holds.ghl_opportunity_name,
      note: inventory_holds.note,
      expiresAt: inventory_holds.expires_at,
      orderNo: inventory_holds.order_no,
      createdAt: inventory_holds.created_at,
    })
    .from(inventory_holds)
    .where(eq(inventory_holds.status, "active"))
    .orderBy(asc(inventory_holds.expires_at));
  return rows.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.sku,
    qty: row.qty,
    salesperson: row.salesperson,
    opportunityName: row.opportunityName,
    note: row.note,
    expiresAt: row.expiresAt,
    orderNo: row.orderNo,
    createdAt: row.createdAt,
  }));
}

/**
 * Sales-curated showroom: Hub snapshot + active holds → CPU projection.
 * Never calls Katana. Never reads the ecommerce listing table.
 */
export async function loadShowroomSalesInventory(input?: {
  embedToken?: string | null;
  tab?: ShowroomSalesTab | null;
  inStockOnly?: boolean;
  query?: string;
}): Promise<SalesInventoryResult> {
  const started = Date.now();
  const session = await resolveStockSession(input?.embedToken);
  if (!session) {
    return { ok: false, error: "Sign in to view live stock.", elapsedMs: Date.now() - started };
  }
  try {
    const [snapshot, holds] = await Promise.all([
      readShowroomSnapshotFromHub(),
      loadActiveHoldsForSales(),
    ]);
    const badge = resolveHubSyncBadge(snapshot.lastSyncedAt);
    let backgroundSyncQueued = false;
    if (badge.shouldQueueBackgroundSync) {
      // Never await Katana — fire-and-forget deduped sync only.
      const queued = await enqueueBackgroundShowroomSync({
        reason: "showroom-sales-read",
      });
      backgroundSyncQueued = queued.queued;
    }
    const projectInput: ProjectShowroomSalesInput = {
      rows: snapshot.rows,
      holds,
      lastSyncedAt: snapshot.lastSyncedAt,
      tab: input?.tab ?? null,
      inStockOnly: input?.inStockOnly,
      query: input?.query,
    };
    const cards = projectShowroomSalesView(projectInput);
    const withImages = await overlayPimImages(cards);
    const merged: SalesStockCard[] = cards.map((card, i) => ({
      ...card,
      imageUrl: withImages[i]?.imageUrl ?? card.imageUrl,
    }));
    return {
      ok: true,
      cards: merged,
      rows: merged,
      syncedAt: snapshot.lastSyncedAt ?? new Date(0).toISOString(),
      stale: badge.tone !== "green",
      warning: sanitizeShowroomSyncWarning(snapshot.error),
      elapsedMs: Date.now() - started,
      badge,
      backgroundSyncQueued,
    };
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : "Could not project sales inventory.";
    return {
      ok: false,
      error: sanitizeShowroomSyncWarning(raw) ?? "Could not load Hub inventory snapshot.",
      elapsedMs: Date.now() - started,
    };
  }
}

/** All active holds (for Active Customer Holds tab / badge overlay). */
export async function listAllActiveShowroomHolds(
  embedToken?: string | null,
): Promise<{ ok: true; holds: ActiveHoldInput[] } | { ok: false; error: string }> {
  const session = await resolveStockSession(embedToken);
  if (!session) return { ok: false, error: "Sign in to view holds." };
  try {
    return { ok: true, holds: await loadActiveHoldsForSales() };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read holds.",
    };
  }
}
