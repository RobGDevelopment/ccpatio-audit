/**
 * Katana may introduce a variant. It may not write packaged dimensions,
 * weight, NMFC class, or lead time. Those columns belong to executives.
 */
export type KatanaLogisticsIdentity = {
  sku: string;
  variantId: number;
};

export type ExistingLogisticsIdentity = {
  variantSku: string;
  katanaVariantId: number;
};

/** Insert payload. Dimension columns are intentionally absent. */
export type LogisticsIdentityInsert = {
  katana_variant_id: number;
  variant_sku: string;
};

export type KatanaLogisticsInsertPlan = {
  pending: LogisticsIdentityInsert[];
  conflicts: string[];
  skipped: number;
};

/**
 * New SKUs become empty logistics rows. An existing SKU is skipped entirely,
 * including when Katana's variant id changed, so a sync cannot replace
 * measurements an executive already saved.
 */
export function planKatanaLogisticsInserts(
  live: readonly KatanaLogisticsIdentity[],
  existing: readonly ExistingLogisticsIdentity[],
): KatanaLogisticsInsertPlan {
  const skuSet = new Set(existing.map((row) => row.variantSku));
  const idSet = new Set(existing.map((row) => row.katanaVariantId));
  const conflicts: string[] = [];
  const pending: LogisticsIdentityInsert[] = [];

  for (const item of live) {
    if (skuSet.has(item.sku)) continue;
    if (idSet.has(item.variantId)) {
      conflicts.push(item.sku);
      continue;
    }
    pending.push({
      katana_variant_id: item.variantId,
      variant_sku: item.sku,
    });
    skuSet.add(item.sku);
    idSet.add(item.variantId);
  }

  return {
    pending,
    conflicts,
    skipped: live.length - pending.length - conflicts.length,
  };
}
