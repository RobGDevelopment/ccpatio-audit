import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { generateFinishedGoodSku } from "@/lib/sku-engine";
import { eq, like, desc } from "drizzle-orm";

export type PromoteToCatalogInput = {
  originalName: string;
  category: string;
  collection?: string;
  length?: string;
  depth?: string;
  createdBy: string;
  attributes?: Record<string, unknown>;
};

export async function promoteToCatalog(input: PromoteToCatalogInput, dbTx?: any) {
  const db = dbTx ?? getDb();

  const memo = input.originalName;
  const collection = input.collection || "";
  const length = input.length || "";
  const depth = input.depth || "";

  // generateFinishedGoodSku gives us the base FIN-* SKU
  const baseSku = generateFinishedGoodSku(memo, collection, length, depth).substring(0, 60);

  // Check for collisions
  const existingSkus = await db.query.sku_mappings.findMany({
    where: like(sku_mappings.global_sku, `${baseSku}%`),
    orderBy: [desc(sku_mappings.global_sku)],
  });

  let finalSku = baseSku;
  if (existingSkus.length > 0) {
    const exactMatch = existingSkus.find((s: any) => s.global_sku === baseSku);
    if (exactMatch) {
      let maxSuffix = 1;
      for (const row of existingSkus) {
        const match = row.global_sku.match(/-(\d{2})$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxSuffix) {
            maxSuffix = num;
          }
        }
      }
      finalSku = `${baseSku}-${(maxSuffix + 1).toString().padStart(2, "0")}`;
    }
  }

  // Insert sku_mappings
  await db.insert(sku_mappings).values({
    global_sku: finalSku,
    original_name: input.originalName,
    product_origin: "manufactured",
    category: input.category || "Custom",
    item_type: "finished_good",
    sync_to_woo: false,
    sync_to_clover: false,
    attributes: {
      ...(input.attributes || {}),
      custom_build: false,
    },
    updated_by: input.createdBy,
  });

  return {
    globalSku: finalSku,
  };
}
