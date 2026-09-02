/**
 * Ocean-specific wrappers over the collection-parameterized catalog helpers.
 * New collections should use src/lib/collection-catalog.ts directly.
 */
import {
  buildSubAssemblies,
  COLLECTION_SOURCE,
  COLLECTIONS,
  modelCodeFromSkus,
  productNeedsCushion,
  stripVariantSuffix,
  type KatanaProductLike,
  type SubAssemblySeed,
} from "@/lib/collection-catalog";

export type { KatanaProductLike };
export type OceanSubAssemblySeed = SubAssemblySeed;

export const OCEAN_SA_SOURCE = COLLECTION_SOURCE;

export function stripOceanVariantSuffix(sku: string): string {
  return stripVariantSuffix(sku);
}

export function oceanModelCodeFromSkus(skus: string[]): string {
  return modelCodeFromSkus(skus, COLLECTIONS.ocean.skuPrefix);
}

export function oceanProductNeedsCushion(name: string): boolean {
  return productNeedsCushion(name);
}

export function buildOceanSubAssemblies(
  products: KatanaProductLike[],
): OceanSubAssemblySeed[] {
  return buildSubAssemblies(products, COLLECTIONS.ocean);
}
