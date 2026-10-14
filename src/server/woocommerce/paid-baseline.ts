/**
 * Phase B1: decide what a PAID WooCommerce delivery means relative to the first one.
 *
 * The first paid delivery for an order writes a baseline row in `incoming_webhooks`
 * (`woo-paid-baseline:<orderId>`) holding the delivery key and the manufacturing fingerprint.
 * Every later paid delivery is compared against it:
 *
 *   first        no baseline, or the baseline was never enqueued: enqueue this delivery
 *   redelivery   same delivery key as the enqueued baseline: re-send (Inngest dedupes by event id)
 *   unchanged    different delivery, same fingerprint (routine status/note update): acknowledge
 *   edited       different delivery, different fingerprint: post-payment edit, alert only
 *
 * An `edited` order is NEVER reprocessed automatically (operator decision D9).
 */
import {
  getIncomingWebhook,
  insertIncomingWebhookOnce,
  setIncomingWebhookPayload,
  type IncomingWebhookRow,
  type WebhookLogInput,
} from "@/server/webhooks/incoming-log";

export function wooBaselineKey(orderId: string | number): string {
  return `woo-paid-baseline:${orderId}`;
}

export type BaselinePayload = {
  orderId: string;
  deliveryKey: string;
  fingerprint: string;
};

export type BaselineDeps = {
  insertOnce(input: WebhookLogInput): Promise<"inserted" | "duplicate">;
  get(idempotencyKey: string): Promise<IncomingWebhookRow | null>;
  set(
    idempotencyKey: string,
    status: "received" | "processed" | "failed",
    payload: unknown,
  ): Promise<void>;
};

export const defaultBaselineDeps: BaselineDeps = {
  insertOnce: (input) => insertIncomingWebhookOnce(input),
  get: (key) => getIncomingWebhook(key),
  set: (key, status, payload) => setIncomingWebhookPayload(key, status, payload),
};

export type BaselineDecision =
  | { kind: "first" }
  | { kind: "redelivery" }
  | { kind: "unchanged" }
  | { kind: "edited"; previousFingerprint: string | null };

function readBaselinePayload(payload: unknown): Partial<BaselinePayload> {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  return {
    orderId: typeof p.orderId === "string" ? p.orderId : undefined,
    deliveryKey: typeof p.deliveryKey === "string" ? p.deliveryKey : undefined,
    fingerprint: typeof p.fingerprint === "string" ? p.fingerprint : undefined,
  };
}

export async function decidePaidDelivery(
  input: { orderId: string; deliveryKey: string; fingerprint: string; topic: string },
  deps: BaselineDeps = defaultBaselineDeps,
): Promise<BaselineDecision> {
  const key = wooBaselineKey(input.orderId);
  const payload: BaselinePayload = {
    orderId: input.orderId,
    deliveryKey: input.deliveryKey,
    fingerprint: input.fingerprint,
  };

  const inserted = await deps.insertOnce({
    source: "woocommerce",
    eventName: `baseline:${input.topic}`,
    idempotencyKey: key,
    payload,
    status: "received",
  });
  if (inserted === "inserted") return { kind: "first" };

  const row = await deps.get(key);
  if (!row) {
    throw new Error(`Paid baseline ${key} exists on insert but could not be read back.`);
  }
  if (row.status !== "processed") {
    // The baseline delivery was never successfully enqueued. This delivery (latest state of an
    // order that has not been manufactured) takes over; the baseline is rewritten on success.
    return { kind: "first" };
  }

  const baseline = readBaselinePayload(row.payload);
  if (baseline.deliveryKey === input.deliveryKey) return { kind: "redelivery" };
  if (baseline.fingerprint === input.fingerprint) return { kind: "unchanged" };
  return { kind: "edited", previousFingerprint: baseline.fingerprint ?? null };
}

/** Called after `inngest.send` succeeded: pins the baseline to the delivery that was enqueued. */
export async function markBaselineEnqueued(
  input: { orderId: string; deliveryKey: string; fingerprint: string },
  deps: BaselineDeps = defaultBaselineDeps,
): Promise<void> {
  const payload: BaselinePayload = {
    orderId: input.orderId,
    deliveryKey: input.deliveryKey,
    fingerprint: input.fingerprint,
  };
  await deps.set(wooBaselineKey(input.orderId), "processed", payload);
}
