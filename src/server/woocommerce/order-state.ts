/**
 * Woo order lifecycle classification (roadmap step 6). PURE: no I/O.
 *
 * ASSUMPTION (flagged for QC in the handback): Katana SO/MO creation waits for the PAID
 * transition. That makes the compensation rule "delete MOs, then the SO" applicable only
 * strictly PRE-payment, so a paid order is never auto-deleted and the Phase 10 saga has no
 * delete executor at all. "Paid" is:
 *   - `status` is `processing` or `completed`, OR
 *   - `date_paid` is a non-empty string (Woo stamps it when payment is received).
 */

type WooOrderStateInput = { status?: unknown; date_paid?: unknown };

const PAID_STATUSES: ReadonlySet<string> = new Set(["processing", "completed"]);
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["cancelled", "refunded", "failed"]);

function normalizedStatus(order: WooOrderStateInput): string {
  return typeof order.status === "string" ? order.status.trim().toLowerCase() : "";
}

function hasDatePaid(order: WooOrderStateInput): boolean {
  return typeof order.date_paid === "string" && order.date_paid.trim().length > 0;
}

export function isWooOrderPaid(order: WooOrderStateInput): boolean {
  return PAID_STATUSES.has(normalizedStatus(order)) || hasDatePaid(order);
}

export type WooOrderClass =
  | "paid"
  | "awaiting_payment"
  | "terminal_unpaid"
  | "terminal_after_paid_needs_human";

/**
 * - `paid`: processing / completed (or `date_paid` set on a non-terminal status).
 * - `awaiting_payment`: pending, on-hold, checkout-draft, anything unrecognised. No event.
 * - `terminal_unpaid`: cancelled / refunded / failed with no payment on record. Acked, no event.
 * - `terminal_after_paid_needs_human`: cancelled / refunded / failed WITH a payment on record.
 *   Never an automatic Katana delete; the route alerts a human.
 *
 * Terminal statuses win over `date_paid`: a refunded order keeps its `date_paid`, and it must
 * not be treated as freshly payable.
 */
export function classifyWooOrder(order: WooOrderStateInput): WooOrderClass {
  const status = normalizedStatus(order);
  if (TERMINAL_STATUSES.has(status)) {
    return hasDatePaid(order) ? "terminal_after_paid_needs_human" : "terminal_unpaid";
  }
  return isWooOrderPaid(order) ? "paid" : "awaiting_payment";
}
