import { and, asc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { finished_goods_catalog, sku_mappings } from "@/server/db/schema";
import { snapshotMsrp } from "@/server/quotes/msrp";

export type OrderDeskCatalogProduct = {
  sku: string;
  variantId: number;
  name: string;
  unitPrice: string | null;
};

/**
 * Finished goods already mapped to a Katana variant. This read stays in
 * Postgres so a quote keystroke does not call Katana.
 */
export async function searchFinishedGoods(query: string): Promise<OrderDeskCatalogProduct[]> {
  const needle = query.trim().replace(/[%_\\]/g, "");
  if (needle.length < 2) return [];

  const db = getDb();
  const pattern = `%${needle}%`;
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      variantId: sku_mappings.katana_variant_id,
      msrp: finished_goods_catalog.msrp,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    )
    .where(
      and(
        eq(sku_mappings.item_type, "finished_good"),
        eq(sku_mappings.is_active, true),
        isNotNull(sku_mappings.katana_variant_id),
        or(
          ilike(sku_mappings.global_sku, pattern),
          ilike(sku_mappings.original_name, pattern),
          ilike(finished_goods_catalog.description, pattern),
        ),
      ),
    )
    .orderBy(asc(sku_mappings.global_sku))
    .limit(12);

  return rows.flatMap((row) => {
    if (row.variantId == null || row.variantId <= 0) return [];
    const name = row.name.replace(/\s+/g, " ").trim();
    return [
      {
        sku: row.sku.trim().toUpperCase(),
        variantId: row.variantId,
        name: name || row.sku.trim().toUpperCase(),
        unitPrice: snapshotMsrp(row.msrp).unitPrice,
      },
    ];
  });
}
