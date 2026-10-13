/**
 * WooCommerce webhook ingress helpers (roadmap step 6). PURE: no I/O, no env reads.
 *
 * WooCommerce signs every delivery with `X-WC-Webhook-Signature` =
 * base64( HMAC-SHA256( secret, RAW request body ) ). The route must verify against the raw
 * bytes it read ONCE with `req.text()`, and only THEN `JSON.parse`.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { inngestEventId } from "@/server/sre/idempotency";

/** Event the registered `processWooCommerceOrder` function listens on. */
export const WOO_ORDER_EVENT = "woo.order.validated";

/** `saga_runs.saga_type` for the Woo paid-order saga. */
export const WOO_SAGA_TYPE = "path_b_woo";

/**
 * Field the route embeds in the event payload so the saga can update the right
 * `incoming_webhooks` audit row (its `idempotency_key` is the delivery key).
 */
export const WOO_DELIVERY_KEY_FIELD = "_cc_delivery_key";

/** Topics the route processes; everything else is acknowledged and ignored. */
export const WOO_ACCEPTED_TOPICS: ReadonlySet<string> = new Set(["order.created", "order.updated"]);

/**
 * Verify `X-WC-Webhook-Signature`.
 *
 * Accepts ONLY the base64 HMAC-SHA256 digest WooCommerce sends. A hex digest, a `sha256=`
 * prefix or a bare bearer token is rejected on purpose: accepting alternates widens the
 * forgery surface for no benefit. Fails closed on a missing/blank secret or header, and uses
 * `timingSafeEqual` after a length check (it throws on unequal lengths).
 */
export function verifyWooWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): boolean {
  const trimmedSecret = secret?.trim();
  if (!trimmedSecret) return false;
  const given = signatureHeader?.trim();
  if (!given) return false;

  const expected = createHmac("sha256", trimmedSecret).update(rawBody, "utf8").digest("base64");
  const givenBuf = Buffer.from(given, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (givenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(givenBuf, expectedBuf);
}

/** Deterministic Inngest event id for a paid order: `woo:order:<id>:paid`. */
export function wooEventId(order: { id: number | string }): string {
  return inngestEventId("woo:order", order.id, "paid");
}

/**
 * Key for the `incoming_webhooks` audit row. `X-WC-Webhook-Delivery-ID` when present, else a
 * sha256 of the raw body. Never `"unknown"`: that would collapse every id-less delivery onto
 * one row.
 */
export function wooDeliveryKey(
  headers: { get(name: string): string | null },
  rawBody: string,
): string {
  const deliveryId = headers.get("x-wc-webhook-delivery-id")?.trim();
  if (deliveryId) return `woo-delivery:${deliveryId}`;
  return `woo-body:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
}

/**
 * The form-encoded ping WooCommerce POSTs when a webhook is saved: `webhook_id=<n>`.
 * Only meaningful AFTER the signature check passed.
 */
export function isWooPingBody(rawBody: string): boolean {
  return /^webhook_id=\d+$/.test(rawBody.trim());
}
