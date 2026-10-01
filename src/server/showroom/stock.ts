import { getPimSession } from "@/lib/pim-audit";
import type { StockRow } from "@/lib/stock-display";
import { getDb } from "@/server/db/client";
import { finished_goods_catalog } from "@/server/db/schema";
import {
  listStockCollections,
  searchKatanaStock,
  type StockCollectionResult,
  type StockSearchResult,
} from "@/server/stock/search-katana-stock";

export type ShowroomStockFilter = "fabrics" | "dekton" | "frames";

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

export async function listShowroomCollections(
  filter: ShowroomStockFilter,
): Promise<StockCollectionResult> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to view live stock." };
  return listStockCollections({ family: filter });
}

export async function searchShowroomStock(input: {
  query?: string;
  filter?: ShowroomStockFilter;
  collection?: string;
}): Promise<StockSearchResult> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to view live stock." };

  const result = await searchKatanaStock({
    query: input.query,
    collection: input.collection,
    family: input.filter,
  });
  if (!result.ok) return result;
  return { ok: true, rows: await overlayPimImages(result.rows) };
}
