/**
 * Resolve a `?sku=` deep link (e.g. from the Master Catalog Factory band) to a
 * hub finished good that is NOT in the vividworks sidebar list. Read-only.
 * Returns null when the SKU is not a `finished_good` row in sku_mappings.
 */
import { eq, inArray } from "drizzle-orm";
import { rollupReviewStatus } from "@/app/admin/factory-bom/factory-bom-ui";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "@/server/db/schema";
import { subAssemblySku } from "@/lib/heuristic-bom";
import type { FactoryProductRow } from "./list-factory-products";

export async function resolveLinkedFinishedGood(
  skuRaw: string,
): Promise<FactoryProductRow | null> {
  const sku = skuRaw.trim().toUpperCase();
  if (!sku) return null;
  const db = getDb();

  const [row] = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      collection: sku_mappings.category,
      phaseSource: sku_mappings.source_file,
      itemType: sku_mappings.item_type,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      msrp: finished_goods_catalog.msrp,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!row || row.itemType !== "finished_good") return null;

  const parents = [
    sku,
    subAssemblySku(sku, "FRAME"),
    subAssemblySku(sku, "CUSH"),
  ];
  const [draftRows, liveRows] = await Promise.all([
    db
      .select({ status: product_bom_draft.status })
      .from(product_bom_draft)
      .where(inArray(product_bom_draft.parent_sku, parents)),
    db
      .selectDistinct({ parent_sku: product_bom.parent_sku })
      .from(product_bom)
      .where(inArray(product_bom.parent_sku, parents)),
  ]);

  return {
    sku: row.sku,
    name: row.name,
    collection: row.collection,
    phaseSource: row.phaseSource,
    length: row.length,
    depth: row.depth,
    height: row.height,
    msrp: row.msrp,
    reviewStatus: rollupReviewStatus(draftRows.map((d) => d.status)),
    liveBom: liveRows.length > 0,
    draftLineCount: draftRows.length,
  };
}
