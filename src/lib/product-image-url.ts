import { getSupabaseUrl } from "@/lib/supabase-env";

export const VARIANT_IMAGE_BUCKET = "product-images";
export const VARIANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;

/** Object name is always `{SKU}.jpg`, regardless of the source file type. */
export function variantImageObjectName(sku: string): string | null {
  const clean = sku.trim().toUpperCase();
  if (!SKU_PATTERN.test(clean)) return null;
  return `${clean}.jpg`;
}

/** Public URL for the SKU photo. Null when the SKU or Supabase URL is unusable. */
export function variantImagePublicUrl(sku: string): string | null {
  const name = variantImageObjectName(sku);
  const base = getSupabaseUrl()?.replace(/\/$/, "");
  if (!name || !base) return null;
  return `${base}/storage/v1/object/public/${VARIANT_IMAGE_BUCKET}/${encodeURIComponent(name)}`;
}
