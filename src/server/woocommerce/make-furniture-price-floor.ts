/**
 * Storefront price-floor circuit breaker for Make furniture SKUs.
 * Blocks accidental `$25` typos from publishing to WooCommerce while allowing
 * Cabana pillows, covers, and accessories (e.g. $65 pillows) through.
 */

export const MAKE_FURNITURE_MIN_REGULAR_PRICE = 250;

const PILLOW_COVER_ACCESSORY_RE =
  /\b(PILLOW|COVER|ACCESSOR|UMBRELLA\s*COVER|CUSHION\s*COVER|WEIGHT|POCKET|ADD-?ON|ADDON)\b/i;

/**
 * Make furniture = FIN-* manufactured goods that are NOT pillows, covers, or accessories.
 * Resale (3P-*) and non-FIN namespaces are out of scope for this floor.
 */
export function isMakeFurnitureSku(
  sku: string,
  productName?: string | null,
): boolean {
  const needle = sku.trim().toUpperCase();
  if (!needle.startsWith("FIN-")) return false;
  const haystack = `${needle} ${productName ?? ""}`;
  if (PILLOW_COVER_ACCESSORY_RE.test(haystack)) return false;
  // Cabana MIS pillows often omit "PILLOW" in the SKU (e.g. FIN-CAB-MIS-17X17).
  if (/^FIN-CAB-MIS-/i.test(needle)) return false;
  return true;
}

export function parseMoney(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type PriceFloorViolation = {
  sku: string;
  regularPrice: number;
  reason: string;
};

/**
 * Returns a violation when a Make furniture SKU would publish below the floor
 * (or at/below zero). Non-furniture SKUs always pass (null).
 */
export function checkMakeFurniturePriceFloor(input: {
  sku: string;
  regularPrice: string | number | null | undefined;
  productName?: string | null;
}): PriceFloorViolation | null {
  if (!isMakeFurnitureSku(input.sku, input.productName)) return null;
  const price = parseMoney(input.regularPrice);
  if (price == null) {
    return {
      sku: input.sku.trim().toUpperCase(),
      regularPrice: NaN,
      reason: `Make furniture SKU ${input.sku.trim().toUpperCase()} has a missing/invalid regular_price — refusing Woo push (floor $${MAKE_FURNITURE_MIN_REGULAR_PRICE}).`,
    };
  }
  if (price <= 0 || price < MAKE_FURNITURE_MIN_REGULAR_PRICE) {
    return {
      sku: input.sku.trim().toUpperCase(),
      regularPrice: price,
      reason: `Make furniture SKU ${input.sku.trim().toUpperCase()} regular_price $${price.toFixed(2)} is below the $${MAKE_FURNITURE_MIN_REGULAR_PRICE} storefront floor (or <= $0) — refusing Woo push to prevent a typo going live.`,
    };
  }
  return null;
}

export class MakeFurniturePriceFloorError extends Error {
  readonly code = "MAKE_FURNITURE_PRICE_FLOOR";
  readonly sku: string;
  readonly regularPrice: number;

  constructor(violation: PriceFloorViolation) {
    super(violation.reason);
    this.name = "MakeFurniturePriceFloorError";
    this.sku = violation.sku;
    this.regularPrice = violation.regularPrice;
  }
}

/** Throws MakeFurniturePriceFloorError when any variation violates the floor. */
export function assertMakeFurniturePriceFloor(input: {
  parentSku: string;
  parentName?: string | null;
  variations: Array<{
    sku: string;
    regularPrice: string | number | null | undefined;
  }>;
}): void {
  for (const variation of input.variations) {
    const violation = checkMakeFurniturePriceFloor({
      sku: variation.sku || input.parentSku,
      regularPrice: variation.regularPrice,
      productName: input.parentName,
    });
    if (violation) throw new MakeFurniturePriceFloorError(violation);
  }
}
