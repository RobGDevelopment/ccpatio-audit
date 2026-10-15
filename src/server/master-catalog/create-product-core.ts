import { max } from "drizzle-orm";
import {
  finished_goods_catalog,
  sku_mappings,
  ecommerce_listings,
  third_party_sources,
} from "@/server/db/schema";
import type { MiddlewareDb } from "@/server/db/client";

type DbTx = MiddlewareDb | Parameters<Parameters<MiddlewareDb["transaction"]>[0]>[0];

export type CreateProductCorePayload = {
  sku: string;
  productName: string;
  origin?: "manufactured" | "third_party";
  categoryLabel?: string;
  collectionLabel?: string;
  length?: string | number | null;
  depth?: string | number | null;
  sourceFile?: string;
  syncToWoo?: boolean;
  syncToClover?: boolean;
  attributes?: Record<string, unknown>;
  thirdPartyFields?: {
    vendorName: string;
    vendorSku: string;
    wholesaleCost: string;
  };
};

export async function createNewProductCore(
  tx: DbTx,
  payload: CreateProductCorePayload,
  actor?: string
) {
  const origin = payload.origin || "manufactured";
  const sourceFile = payload.sourceFile || "master-catalog-new-product";

  // 1. Insert sku_mappings
  await tx.insert(sku_mappings).values({
    global_sku: payload.sku,
    product_origin: origin,
    category: payload.categoryLabel || "Uncategorized",
    item_type: "finished_good",
    original_name: payload.productName,
    source_file: sourceFile,
    is_active: true,
    sync_to_woo: payload.syncToWoo ?? false,
    sync_to_clover: payload.syncToClover ?? false,
    attributes: payload.attributes || {},
    updated_by: actor,
  });

  // 1.5 Insert third_party_sources if needed
  if (origin === "third_party" && payload.thirdPartyFields) {
    await tx.insert(third_party_sources).values({
      global_sku: payload.sku,
      vendor_name: payload.thirdPartyFields.vendorName,
      vendor_sku: payload.thirdPartyFields.vendorSku,
      wholesale_cost: payload.thirdPartyFields.wholesaleCost,
    });
  }

  // 2. Insert finished_goods_catalog
  await tx.insert(finished_goods_catalog).values({
    global_sku: payload.sku,
    length: payload.length !== undefined && payload.length !== null ? String(payload.length) : null,
    depth: payload.depth !== undefined && payload.depth !== null ? String(payload.depth) : null,
    updated_by: actor,
  });

  // 3. Insert ecommerce_listings
  const [{ top }] = await tx
    .select({ top: max(ecommerce_listings.sheet_order) })
    .from(ecommerce_listings);
  const base = top ?? 0;

  const [row] = await tx
    .insert(ecommerce_listings)
    .values({
      global_sku: payload.sku,
      product_name: payload.productName,
      steel_msrp: null,
      drawing_section: payload.categoryLabel || "Uncategorized",
      collection_label: payload.collectionLabel || "Uncategorized",
      sheet_order: base + 1,
      url_source: "missing",
      url_operator_set: false,
      legacy_operator_set: false,
    })
    .returning();

  return row;
}
