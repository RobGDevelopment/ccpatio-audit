/**
 * Hub → Katana recipe shape (catalog master data, not sales-order MTO).
 *
 * Katana `POST /recipes` expects `{ keep_current_rows, rows: [{ product_variant_id,
 * ingredient_variant_id, quantity, notes }] }`. This module emits the same
 * nested row graph keyed by hub SKUs so E2E can prove we never flatten the BOM
 * into a single text string. Live sync (`syncBOMToKatana`) then substitutes
 * variant IDs.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { product_bom, sku_mappings, type ItemType } from "@/server/db/schema";

export type HubRecipeLine = {
  parentSku: string;
  childSku: string;
  childItemType: ItemType;
  quantity: number;
  scrapFactor: number;
  effectiveQuantity: number;
  unitOfMeasure: string;
  /** Chop-saw / mitre cut-list for Katana recipe notes (not UOM). */
  notes: string;
};

export type KatanaRecipePostBody = {
  keep_current_rows: false;
  rows: Array<{
    product_sku: string;
    ingredient_sku: string;
    quantity: number;
    notes: string;
  }>;
};

export async function collectLiveBomParents(rootSku: string): Promise<string[]> {
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({
        child: product_bom.child_sku,
        type: sku_mappings.item_type,
      })
      .from(product_bom)
      .leftJoin(sku_mappings, eq(product_bom.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

export async function loadLiveHubRecipeLines(
  rootSku: string,
): Promise<HubRecipeLine[]> {
  const db = getDb();
  const parents = await collectLiveBomParents(rootSku);
  const lines: HubRecipeLine[] = [];
  for (const parent of parents) {
    const rows = await db
      .select({
        parent: product_bom.parent_sku,
        child: product_bom.child_sku,
        quantity: product_bom.quantity,
        scrap: product_bom.scrap_factor,
        uom: product_bom.unit_of_measure,
        notes: product_bom.notes,
        childType: sku_mappings.item_type,
      })
      .from(product_bom)
      .leftJoin(sku_mappings, eq(product_bom.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom.parent_sku, parent));
    for (const row of rows) {
      const quantity = Number(row.quantity);
      const scrapFactor = Number(row.scrap ?? "1");
      const safeScrap = Number.isFinite(scrapFactor) && scrapFactor > 0 ? scrapFactor : 1;
      lines.push({
        parentSku: row.parent,
        childSku: row.child,
        childItemType: row.childType ?? "raw_material",
        quantity,
        scrapFactor: safeScrap,
        effectiveQuantity: quantity * safeScrap,
        unitOfMeasure: row.uom,
        notes: (row.notes ?? "").trim(),
      });
    }
  }
  return lines;
}

export function toKatanaRecipePosts(lines: HubRecipeLine[]): KatanaRecipePostBody[] {
  const byParent = new Map<string, HubRecipeLine[]>();
  for (const line of lines) {
    const bucket = byParent.get(line.parentSku) ?? [];
    bucket.push(line);
    byParent.set(line.parentSku, bucket);
  }
  return [...byParent.entries()].map(([, group]) => ({
    keep_current_rows: false as const,
    rows: group.map((line) => ({
      product_sku: line.parentSku,
      ingredient_sku: line.childSku,
      quantity: line.effectiveQuantity,
      notes: line.notes || line.unitOfMeasure,
    })),
  }));
}
