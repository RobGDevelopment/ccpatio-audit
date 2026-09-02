import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  upsertKatanaMaterial,
  upsertKatanaProduct,
  upsertKatanaRecipeRow,
} from "./client";

export async function syncBOMToKatana(
  parentSku: string,
  childSku: string,
  quantity: number
) {
  const db = getDb();

  // 1. Query the Drizzle database to get the full records
  const [parentRecord] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, parentSku))
    .limit(1);

  const [childRecord] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, childSku))
    .limit(1);

  if (!parentRecord) {
    throw new Error(`Parent SKU not found in DB: ${parentSku}`);
  }
  if (!childRecord) {
    throw new Error(`Child SKU not found in DB: ${childSku}`);
  }

  // 2. Call upsertKatanaProduct for the parent
  // Assuming a default sales price of 0, as MSRP is in finished_goods_catalog
  const parentVariantId = await upsertKatanaProduct(parentRecord, 0);

  // 3. Call upsertKatanaMaterial (or product) for the child
  let childVariantId: number;
  if (
    childRecord.item_type === "finished_good" ||
    childRecord.item_type === "sub_assembly"
  ) {
    childVariantId = await upsertKatanaProduct(childRecord, 0);
  } else {
    childVariantId = await upsertKatanaMaterial(childRecord);
  }

  // 4. Execute a Drizzle UPDATE to save Katana IDs back into katana_variant_id
  await db
    .update(sku_mappings)
    .set({ katana_variant_id: parentVariantId })
    .where(eq(sku_mappings.global_sku, parentSku));

  await db
    .update(sku_mappings)
    .set({ katana_variant_id: childVariantId })
    .where(eq(sku_mappings.global_sku, childSku));

  // 5. Call upsertKatanaRecipeRow using the newly acquired Katana Variant IDs
  await upsertKatanaRecipeRow(parentVariantId, childVariantId, quantity);

  return { success: true, parentVariantId, childVariantId };
}
