/**
 * Phase 9 Task 2 — deterministic idempotency helpers. Pure: no I/O, no env reads.
 *
 * The legacy Woo code silently fell back to "unknown" when an id was missing, which
 * collapses every id-less event onto ONE key and drops real orders. These helpers throw
 * instead: a missing external id is a bug to surface, never a key to invent.
 */
import { createHash } from "node:crypto";

/** QuickBooks `requestid` hard limit. */
export const QBO_REQUEST_ID_MAX_LENGTH = 50;

/**
 * CEL expressions for Inngest function-level `idempotency` (a string option on the
 * function config). `event.id` is the id supplied by the sender (see `inngestEventId`),
 * so a re-sent event with the same id runs at most once per 24h Inngest window.
 */
export const IDEMPOTENCY_BY_EVENT_ID = "event.id";
export const IDEMPOTENCY_BY_GLOBAL_SKU = "event.data.globalSku";
export const IDEMPOTENCY_BY_ORDER_INTAKE_VERSION =
  'event.data.orderIntakeId + "-" + string(event.data.version)';
export const IDEMPOTENCY_BY_CLOVER_PAYMENT = "event.data.merchantId + \":\" + event.data.paymentId";

function requireId(label: string, value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    throw new Error(
      `idempotency: ${label} is missing (got ${JSON.stringify(value)}). Refusing to fall back to "unknown".`,
    );
  }
  return trimmed;
}

/**
 * Deterministic Inngest event id, e.g. `inngestEventId("woo:order", "123")` ->
 * `woo:order:123`. `source` is a namespace and may carry the kind (`woo:order`,
 * `clover:payment`). An optional `discriminator` separates distinct events for the same
 * external id (e.g. `paid`, `updated`).
 */
export function inngestEventId(
  source: string,
  externalId: string | number,
  discriminator?: string,
): string {
  const src = requireId("source", source);
  const id = requireId("externalId", String(externalId));
  const base = `${src}:${id}`;
  if (discriminator === undefined) return base;
  return `${base}:${requireId("discriminator", discriminator)}`;
}

const KATANA_ORDER_NO_PREFIX: Record<string, string> = {
  ghl: "GHL",
  woo: "WOO",
  woocommerce: "WOO",
  path_a: "PA",
  "path-a": "PA",
};

/**
 * Katana sales-order number. MUST match the existing conventions:
 *  - GHL: `GHL-<opportunityId>` (src/server/ghl/hold-order.ts `ghlFactoryOrderNo`)
 *  - Path A: `PA-<opportunityId>` (Phase 11 Path A Sales Order)
 *  - Woo: strictly `WOO-<orderId>` (Phase B1, operator decision D8). The Woo display
 *    `number` is deliberately NOT accepted: there is no override, so the Katana order
 *    number can never drift from the Woo order id. `mapWooOrderToKatanaSalesOrder`
 *    (src/lib/katana.ts) and the Woo saga CALL this helper so the idempotency lookup and
 *    the created SO can never drift apart.
 */
export function katanaOrderNo(source: string, externalId: string | number): string {
  const key = requireId("source", source).toLowerCase();
  const prefix = KATANA_ORDER_NO_PREFIX[key];
  if (!prefix) {
    throw new Error(`katanaOrderNo: unsupported source "${source}" (expected ghl, woo, or path_a).`);
  }
  return `${prefix}-${requireId("externalId", String(externalId))}`;
}

/**
 * Deterministic QBO `requestid` (<= 50 chars): sha256 hex prefix of `sagaKey|leg`.
 * Same input -> same output; different legs of one saga differ.
 */
export function qboRequestId(sagaKey: string, leg: string): string {
  const key = requireId("sagaKey", sagaKey);
  const legId = requireId("leg", leg);
  return createHash("sha256")
    .update(`${key}\u0000${legId}`)
    .digest("hex")
    .slice(0, QBO_REQUEST_ID_MAX_LENGTH);
}
