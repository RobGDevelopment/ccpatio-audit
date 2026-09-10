/**
 * Load approved hub state for Inngest catalog fan-out.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4.
 */
import { eq, inArray } from "drizzle-orm";
import type { HubProductGraph } from "@/mappers/types";
import { getDb } from "@/server/db/client";
import { explodeBomTree } from "@/server/db/queries/bom";
import {
  finished_goods_catalog,
  item_operations,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";

export async function loadHubProductGraph(
  rootSku: string,
): Promise<HubProductGraph> {
  const sku = rootSku.trim().toUpperCase();
  if (!sku) {
    throw new Error("globalSku is required to load hub product graph");
  }

  const db = getDb();
  const [root] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!root) {
    throw new Error(`Hub SKU ${sku} not found in sku_mappings`);
  }

  const [commerce] = await db
    .select()
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, sku))
    .limit(1);

  const explosion = await explodeBomTree(sku);
  const skuSet = new Set<string>([sku]);
  for (const row of explosion) {
    skuSet.add(row.parent_sku.trim().toUpperCase());
    skuSet.add(row.child_sku.trim().toUpperCase());
  }

  const skuList = [...skuSet];
  const mappingRows = await db
    .select()
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, skuList));

  const opsRows = await db
    .select()
    .from(item_operations)
    .where(inArray(item_operations.item_sku, skuList));

  return {
    rootSku: sku,
    skus: mappingRows.map((row) => ({
      globalSku: row.global_sku,
      itemType: row.item_type as ItemType,
      originalName: row.original_name,
      category: row.category,
      uomPurchase: row.uom_purchase,
      uomConsume: row.uom_consume,
      baseCost: row.base_cost != null ? String(row.base_cost) : null,
      katanaVariantId: row.katana_variant_id,
      katanaMaterialId: row.katana_material_id,
      attributes: row.attributes,
    })),
    edges: explosion.map((row) => ({
      parentSku: row.parent_sku.trim().toUpperCase(),
      childSku: row.child_sku.trim().toUpperCase(),
      quantity: Number(row.quantity) || 0,
      scrapFactor: Number(row.scrap_factor) || 1,
      unitOfMeasure: row.unit_of_measure || "ea",
      notes: row.notes,
    })),
    operations: opsRows.map((row) => ({
      itemSku: row.item_sku.trim().toUpperCase(),
      workCenter: row.work_center,
      sequence: row.sequence,
      setupTimeMins:
        row.setup_time_mins != null ? Number(row.setup_time_mins) : null,
      runTimeMins:
        row.run_time_mins != null ? Number(row.run_time_mins) : null,
    })),
    commerce: {
      globalSku: sku,
      name: root.original_name || sku,
      msrp: commerce?.msrp ?? null,
      cost: commerce?.cost ?? null,
      description: commerce?.description ?? null,
      imageUrl: commerce?.image_url ?? null,
      slug: commerce?.slug ?? null,
      seoTitle: commerce?.seo_title ?? null,
      seoDescription: commerce?.seo_description ?? null,
      syncToWoo: root.sync_to_woo,
      syncToClover: root.sync_to_clover,
    },
  };
}
