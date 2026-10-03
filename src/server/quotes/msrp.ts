const PRICE_ERROR = "MSRP is missing or not a number.";

/** Numeric snapshot of `finished_goods_catalog.msrp`. Unparseable text stays null. */
export function snapshotMsrp(raw: string | null | undefined): {
  unitPrice: string | null;
  priceError: string | null;
} {
  if (raw == null) return { unitPrice: null, priceError: PRICE_ERROR };
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return { unitPrice: null, priceError: PRICE_ERROR };
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    return { unitPrice: null, priceError: PRICE_ERROR };
  }
  return { unitPrice: value.toFixed(2), priceError: null };
}

export function lineDescription(
  sku: string,
  description: string | null | undefined,
): string {
  const text = description?.replace(/\s+/g, " ").trim() ?? "";
  return text || sku;
}

/** Null when there are no lines or any line has no price. Does not invent zero. */
export function merchandiseTotal(
  lines: ReadonlyArray<{ unitPrice: string | null; qty: string }>,
): string | null {
  if (lines.length === 0) return null;
  if (lines.some((line) => line.unitPrice == null)) return null;
  const sum = lines.reduce(
    (total, line) => total + Number(line.unitPrice) * Number(line.qty),
    0,
  );
  if (!Number.isFinite(sum)) return null;
  return (Math.round((sum + Number.EPSILON) * 100) / 100).toFixed(2);
}
