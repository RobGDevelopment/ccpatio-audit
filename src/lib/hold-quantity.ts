import { inferMaterialUom } from "@/lib/katana-material-uom";
import { roundQty } from "@/lib/stock-display";

const FROM_KATANA: Record<string, string> = {
  pcs: "ea",
  pc: "ea",
  each: "ea",
  lbs: "lb",
  yds: "yd",
  yards: "yd",
};

/** Showroom label for a unit. Katana `pcs` is the hub's `ea`. */
export function displayStockUom(sku: string, raw?: string | null): string {
  const key = raw?.trim().toLowerCase() ?? "";
  if (key) return FROM_KATANA[key] ?? key;
  return inferMaterialUom(sku).uom;
}

/** Why this quantity cannot be held. Empty input is invalid but has no warning yet. */
export function holdQuantityIssue(raw: string, available: number): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter a quantity of at least 1.";
  const quantity = Number(trimmed);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return "Quantity must be at least 1.";
  }
  if (roundQty(quantity) > roundQty(available)) {
    return "Quantity cannot exceed available stock.";
  }
  return null;
}

/** Red warning after the rep has typed a quantity that cannot be held. */
export function holdQuantityWarning(raw: string, available: number): string | null {
  if (!raw.trim()) return null;
  return holdQuantityIssue(raw, available);
}

export function holdQuantityMath(
  raw: string,
  available: number,
): { quantity: number; available: number; ending: number } | null {
  if (holdQuantityIssue(raw, available)) return null;
  const quantity = roundQty(Number(raw));
  const current = roundQty(available);
  return {
    quantity,
    available: current,
    ending: roundQty(current - quantity),
  };
}
