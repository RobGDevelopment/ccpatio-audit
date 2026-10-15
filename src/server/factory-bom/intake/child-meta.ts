import { inArray, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  sku_mappings,
  raw_materials_catalog,
  finished_goods_catalog,
} from "@/server/db/schema";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";

export type ChildMeta = FactoryProductRow & {
  itemType: string;
  category: string;
  katanaVariantId: number | null;
};

export async function loadChildMeta(skus: string[]): Promise<ChildMeta[]> {
  if (skus.length === 0) return [];
  const db = getDb();

  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sql<string>`COALESCE(NULLIF(${raw_materials_catalog.name}, ''), NULLIF(${finished_goods_catalog.description}, ''), ${sku_mappings.original_name}, ${sku_mappings.global_sku})`,
      collection: sql<string>`COALESCE(${sku_mappings.category}, '')`,
      phaseSource: sql<string>`COALESCE(${sku_mappings.source_file}, '')`,
      itemType: sql<string>`COALESCE(${sku_mappings.item_type}, 'raw_material')`,
      category: sql<string>`COALESCE(${raw_materials_catalog.category}, ${sku_mappings.category}, '')`,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      msrp: finished_goods_catalog.msrp,
      katanaVariantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .leftJoin(raw_materials_catalog, eq(sku_mappings.global_sku, raw_materials_catalog.sku))
    .leftJoin(finished_goods_catalog, eq(sku_mappings.global_sku, finished_goods_catalog.global_sku))
    .where(inArray(sku_mappings.global_sku, skus));

  return rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    collection: r.collection,
    phaseSource: r.phaseSource,
    itemType: r.itemType,
    category: r.category,
    length: r.length,
    depth: r.depth,
    height: r.height,
    msrp: r.msrp,
    reviewStatus: "none" as const,
    liveBom: false,
    draftLineCount: 0,
    katanaVariantId: r.katanaVariantId,
  }));
}
