import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { finished_goods_catalog, sku_mappings } from "@/server/db/schema";

export type CatalogImageWrite =
  | "updated"
  | "skipped-supabase"
  | "missing-sku";

/** Hub-owned storage URL. Woo CDN sync must not replace one of these. */
export function isSupabaseStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/storage/v1/object/public/");
}

/**
 * Attach an image URL to a dictionary SKU.
 * Writes only image_url on finished_goods_catalog. The SKU must already
 * exist on sku_mappings (foreign key). MSRP and dimensions are left alone.
 */
export async function upsertCatalogImageUrl(input: {
  globalSku: string;
  imageUrl: string;
  updatedBy: string;
  preserveSupabaseUrl?: boolean;
}): Promise<CatalogImageWrite> {
  const sku = input.globalSku.trim().toUpperCase();
  const imageUrl = input.imageUrl.trim();
  if (!sku || !imageUrl) {
    throw new Error("globalSku and imageUrl are required");
  }

  const db = getDb();
  const [mapping] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) return "missing-sku";

  if (input.preserveSupabaseUrl) {
    const [existing] = await db
      .select({ imageUrl: finished_goods_catalog.image_url })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, sku))
      .limit(1);
    if (isSupabaseStorageUrl(existing?.imageUrl)) return "skipped-supabase";
  }

  await db
    .insert(finished_goods_catalog)
    .values({
      global_sku: sku,
      image_url: imageUrl,
      updated_by: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: finished_goods_catalog.global_sku,
      set: {
        image_url: imageUrl,
        updated_by: input.updatedBy,
        updated_at: new Date(),
      },
    });
  return "updated";
}
