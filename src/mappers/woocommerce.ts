/**
 * WooCommerce catalog product mapper — pure TypeScript, no HTTP.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 3.
 */
import type { HubFinishedGoodCommerce } from "@/mappers/types";
import { parseMoney } from "@/mappers/types";

export type WooProductPayload = {
  name: string;
  type: "simple";
  sku: string;
  regular_price: string;
  description: string;
  short_description: string;
  slug?: string;
  status: "publish" | "draft";
  manage_stock: boolean;
  images?: Array<{ src: string; name?: string }>;
  meta_data?: Array<{ key: string; value: string }>;
};

export type WooMapperResult =
  | { skip: true; reason: "sync_to_woo_false" }
  | {
      skip: false;
      payload: WooProductPayload;
      idempotencyKey: string;
    };

/**
 * Format a WooCommerce REST create/update product body by SKU.
 * Returns skip when `syncToWoo` is false.
 */
export function mapFinishedGoodToWooCommerce(
  commerce: HubFinishedGoodCommerce,
): WooMapperResult {
  if (!commerce.syncToWoo) {
    return { skip: true, reason: "sync_to_woo_false" };
  }

  const price = parseMoney(commerce.msrp ?? null);
  const regularPrice =
    price != null ? price.toFixed(2) : (commerce.msrp?.trim() || "0.00");

  const payload: WooProductPayload = {
    name: commerce.name || commerce.globalSku,
    type: "simple",
    sku: commerce.globalSku,
    regular_price: regularPrice,
    description: commerce.seoDescription?.trim() || commerce.description?.trim() || "",
    short_description: commerce.seoTitle?.trim() || commerce.name || "",
    status: "publish",
    manage_stock: false,
    meta_data: [
      { key: "_ccpatio_global_sku", value: commerce.globalSku },
    ],
  };

  const slug = commerce.slug?.trim();
  if (slug) {
    payload.slug = slug;
  }

  const imageUrl = commerce.imageUrl?.trim();
  if (imageUrl) {
    payload.images = [{ src: imageUrl, name: commerce.globalSku }];
  }

  return {
    skip: false,
    payload,
    idempotencyKey: `woo-product-${commerce.globalSku}`,
  };
}
