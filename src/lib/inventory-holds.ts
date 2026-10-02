/** Showroom smart hold. Reps may extend by this many days. */
export const SHOWROOM_HOLD_TTL_DAYS = 14;

export const SHOWROOM_HOLD_TTL_HOURS = SHOWROOM_HOLD_TTL_DAYS * 24;

/** Daily warning fires while expiry sits in this window. */
export const HOLD_WARNING_WINDOW_START_HOURS = 24;
export const HOLD_WARNING_WINDOW_END_HOURS = 48;

export const HOLD_EXTEND_MAX_DAYS = 90;

export const SHOWROOM_HOLD_CUSTOMER_NAME = "CC Patio Showroom Hold";
export const SHOWROOM_HOLD_CUSTOMER_EMAIL = "showroom-holds@ccpatio.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_TTL_MS = SHOWROOM_HOLD_TTL_DAYS * DAY_MS;

export function showroomHoldExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + HOLD_TTL_MS);
}

export function holdExpiresAtFromDays(days: number, now = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Inclusive window: expires_at is 24–48 hours from `now`. */
export function holdWarningWindow(now = new Date()): { from: Date; to: Date } {
  const hour = 60 * 60 * 1000;
  return {
    from: new Date(now.getTime() + HOLD_WARNING_WINDOW_START_HOURS * hour),
    to: new Date(now.getTime() + HOLD_WARNING_WINDOW_END_HOURS * hour),
  };
}

/** "Expires in 3 days", or hours when the hold is inside the warning window. */
export function formatHoldExpiry(expiresAt: Date | string, now = new Date()): string {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return "Expiration unknown";
  const ms = expiry.getTime() - now.getTime();
  if (ms <= 0) return "Expired";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= HOLD_WARNING_WINDOW_END_HOURS) {
    return hours === 1 ? "Expires in 1 hour" : `Expires in ${hours} hours`;
  }
  const days = Math.max(1, Math.round(ms / DAY_MS));
  return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
}

/** `HOLD-` plus the first 8 hex characters of the hold UUID. */
export function isHoldId(holdId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(holdId);
}

export function showroomHoldOrderNo(holdId: string): string {
  const hex = holdId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Hold id must be a UUID.");
  }
  return `HOLD-${hex.slice(0, 8)}`;
}
