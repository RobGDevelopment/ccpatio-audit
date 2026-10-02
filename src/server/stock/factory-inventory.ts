import { katanaFetch, resolveLiveKatanaApiBase } from "@/lib/katana";
import { roundQty } from "@/lib/stock-display";
import { CC_MANUFACTURING_LOCATION_ID } from "@/server/ghl/hold-order";

export type FactoryInventory = {
  inStock: number;
  committed: number;
  /** True when Katana returned at least one row at CC Manufacturing. */
  atFactory: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listPayload(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  }
  const wrapped = asRecord(data);
  if (Array.isArray(wrapped?.data)) {
    return wrapped.data
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== null);
  }
  return [];
}

/**
 * In-stock and committed the way the showroom card reads them: the CC
 * Manufacturing location when Katana has a row there, otherwise every location.
 */
export async function readCardInventory(variantId: number): Promise<FactoryInventory> {
  const params = new URLSearchParams();
  params.set("limit", "250");
  params.append("variant_id", String(variantId));
  const { data } = await katanaFetch<unknown>(`/inventory?${params.toString()}`, {
    baseUrl: resolveLiveKatanaApiBase(),
  });
  const rows = listPayload(data).filter((row) => Number(row.variant_id) === variantId);
  const atFactory = rows.filter(
    (row) => Number(row.location_id) === CC_MANUFACTURING_LOCATION_ID,
  );
  const used = atFactory.length > 0 ? atFactory : rows;
  let inStock = 0;
  let committed = 0;
  for (const row of used) {
    inStock += Number(row.quantity_in_stock ?? 0);
    committed += Number(row.quantity_committed ?? 0);
  }
  return {
    inStock: roundQty(inStock),
    committed: roundQty(committed),
    atFactory: atFactory.length > 0,
  };
}

/** Committed quantity on inventory rows at CC Manufacturing only. */
export async function readFactoryCommitted(variantId: number): Promise<number> {
  const params = new URLSearchParams();
  params.set("limit", "250");
  params.append("variant_id", String(variantId));
  const { data } = await katanaFetch<unknown>(`/inventory?${params.toString()}`, {
    baseUrl: resolveLiveKatanaApiBase(),
  });
  let committed = 0;
  for (const row of listPayload(data)) {
    if (Number(row.variant_id) !== variantId) continue;
    if (Number(row.location_id) !== CC_MANUFACTURING_LOCATION_ID) continue;
    committed += Number(row.quantity_committed ?? 0);
  }
  return roundQty(committed);
}
