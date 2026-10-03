export const DISCOUNT_TYPES = ["PERCENTAGE", "FLAT"] as const;

export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export function isDiscountType(value: string): value is DiscountType {
  return value === "PERCENTAGE" || value === "FLAT";
}

/** Blank is zero. Rejects negatives and more than two decimal places. */
export function parseMoneyAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return roundMoney(value);
}

export type QuoteCommercialInput = {
  customerName: string;
  customerEmail: string;
  billToAddress: string;
  shipToAddress: string;
  discountAmount: string;
  discountType: string;
  taxAmount: string;
};

export type QuoteCommercialPatch = {
  customerName: string | null;
  customerEmail: string | null;
  billToAddress: string | null;
  shipToAddress: string | null;
  discountAmount: string;
  discountType: DiscountType;
  taxAmount: string;
};

function optionalText(raw: string, max: number): string | null {
  const text = raw.trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function parseQuoteCommercials(
  input: QuoteCommercialInput,
): { ok: true; patch: QuoteCommercialPatch } | { ok: false; error: string } {
  if (!isDiscountType(input.discountType)) {
    return { ok: false, error: "Discount must be a percent or a flat amount." };
  }
  const discount = parseMoneyAmount(input.discountAmount);
  if (discount == null) {
    return { ok: false, error: "Discount must be a positive amount." };
  }
  if (input.discountType === "PERCENTAGE" && discount > 100) {
    return { ok: false, error: "Discount percent cannot exceed 100." };
  }
  const tax = parseMoneyAmount(input.taxAmount);
  if (tax == null) return { ok: false, error: "Tax must be a positive amount." };

  const customerEmail = optionalText(input.customerEmail, 320);
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return { ok: false, error: "Customer email is not valid." };
  }

  return {
    ok: true,
    patch: {
      customerName: optionalText(input.customerName, 200),
      customerEmail,
      billToAddress: optionalText(input.billToAddress, 2000),
      shipToAddress: optionalText(input.shipToAddress, 2000),
      discountAmount: discount.toFixed(2),
      discountType: input.discountType,
      taxAmount: tax.toFixed(2),
    },
  };
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Extended price for one row. Empty or non-numeric prices do not contribute. */
export function lineExtended(unitPrice: string | null, qty: string): number | null {
  if (unitPrice == null || unitPrice.trim() === "") return null;
  const price = Number(unitPrice);
  const count = Number(qty);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return roundMoney(price * count);
}

/**
 * Dollar discount taken off subtotal.
 * Percentage is 0–100 of subtotal. A flat amount cannot exceed subtotal.
 */
export function discountDollars(
  subtotal: number,
  amount: number,
  type: DiscountType,
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const raw =
    type === "PERCENTAGE" ? subtotal * (Math.min(amount, 100) / 100) : amount;
  return roundMoney(Math.min(raw, subtotal));
}

/** Subtotal − discount + tax + shipping. */
export function quoteGrandTotal(input: {
  subtotal: number;
  discountAmount: number;
  discountType: DiscountType;
  tax: number;
  shipping: number;
}): { discount: number; tax: number; shipping: number; total: number } {
  const subtotal = Number.isFinite(input.subtotal) && input.subtotal > 0
    ? roundMoney(input.subtotal)
    : 0;
  const discount = discountDollars(subtotal, input.discountAmount, input.discountType);
  const tax = Number.isFinite(input.tax) && input.tax > 0 ? roundMoney(input.tax) : 0;
  const shipping =
    Number.isFinite(input.shipping) && input.shipping > 0 ? roundMoney(input.shipping) : 0;
  const total = roundMoney(subtotal - discount + tax + shipping);
  return { discount, tax, shipping, total };
}
