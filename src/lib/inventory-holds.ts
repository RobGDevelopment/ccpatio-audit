/** Showroom soft hold. No extension in this slice. */
export const SHOWROOM_HOLD_TTL_HOURS = 72;

export const SHOWROOM_HOLD_CUSTOMER_NAME = "CC Patio Showroom Hold";
export const SHOWROOM_HOLD_CUSTOMER_EMAIL = "showroom-holds@ccpatio.com";

const HOLD_TTL_MS = SHOWROOM_HOLD_TTL_HOURS * 60 * 60 * 1000;

export function showroomHoldExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + HOLD_TTL_MS);
}

/** `HOLD-` plus the first 8 hex characters of the hold UUID. */
export function showroomHoldOrderNo(holdId: string): string {
  const hex = holdId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Hold id must be a UUID.");
  }
  return `HOLD-${hex.slice(0, 8)}`;
}
