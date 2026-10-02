import { timingSafeEqual } from "node:crypto";

/** Read-only GHL iframe gate. Never falls back to an empty secret. */
export function stockCheckerAuthorized(given: string | null | undefined): boolean {
  const expected = process.env.STOCK_CHECKER_TOKEN?.trim() ?? "";
  const token = given?.trim() ?? "";
  if (!expected || !token) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function stockCheckerConfigured(): boolean {
  return Boolean(process.env.STOCK_CHECKER_TOKEN?.trim());
}
