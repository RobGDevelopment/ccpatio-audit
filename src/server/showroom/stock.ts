import {
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { GHL_EMBED_PRINCIPAL_EMAIL, getPimSession, type PimSession } from "@/lib/pim-audit";
import type { StockRow } from "@/lib/stock-display";
import { getDb } from "@/server/db/client";
import { finished_goods_catalog } from "@/server/db/schema";
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
  readShowroomSnapshotFromHub,
  refreshShowroomSnapshotFromKatana,
} from "@/server/stock/showroom-snapshot";

async function resolveStockSession(embedToken?: string | null): Promise<PimSession | null> {
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
  if (bySku.size === 0) return rows;
  return rows.map((row) => ({
    ...row,
    imageUrl: bySku.get(row.sku) ?? row.imageUrl,
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
    uom: row.uom?.trim() || "ea",
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
    const snapshot = input?.force
      ? await refreshShowroomSnapshotFromKatana({ force: true })
      : await readShowroomSnapshotFromHub();
    const filter = input?.typeFilter ?? "all";
    const rows = snapshot.rows
      .filter((row) => matchesTypeFilter(row.itemType, filter))
      .map(toStockRow);
    return {
      ok: true,
      rows: await overlayPimImages(rows),
      syncedAt: snapshot.lastSyncedAt ?? new Date(0).toISOString(),
      stale: snapshot.stale || !snapshot.lastSyncedAt,
      warning: snapshot.error,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Hub inventory snapshot.",
    };
  }
}
