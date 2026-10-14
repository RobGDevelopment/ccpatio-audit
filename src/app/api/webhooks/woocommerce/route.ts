/**
 * POST /api/webhooks/woocommerce
 *
 * Roadmap step 6 (FINAL_INTEGRATION_ROADMAP.md, CLAUDE.md): paid WooCommerce orders enter the
 * hub here. This SUPERSEDES the earlier 410 "retired" stub described in
 * docs/MDM_MASTER_BLUEPRINT.md Phase 0.
 *
 * The route is a thin, fast ingress:
 *   verify -> structural parse -> classify -> (paid: baseline decision) -> validate against the
 *   live hub DB -> audit -> enqueue.
 * It performs NO Katana, QBO or Clover I/O. The Inngest function `process-woocommerce-order`
 * (src/inngest/woo-order.ts) does the heavy work behind ORDER_PIPELINE_MODE (default `log`,
 * i.e. a dry run) and LEDGER_PIPELINE_MODE (default `log`).
 *
 * Phase B1: SKU authority is the hub database (sku-resolver.ts), not a static dictionary. The
 * only accepted finish keys are fabric / powder_coat / frame (finish-keys.ts). A paid order that
 * changes after its first paid delivery was processed is quarantined as `post_payment_edit` and
 * alerted, never reprocessed (paid-baseline.ts).
 *
 * Non-2xx is reserved for: missing secret (503), bad signature (401), unparseable JSON (400)
 * and a persistence/enqueue failure (500). WooCommerce disables a webhook after repeated
 * non-2xx deliveries, so a validation problem is quarantined and acknowledged (202).
 */
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getOrderPipelineMode } from "@/server/pipeline/mode";
import { sagaStore } from "@/server/sre/saga-store";
import {
  insertIncomingWebhookOnce,
  updateIncomingWebhookStatus,
} from "@/server/webhooks/incoming-log";
import {
  isWooPingBody,
  verifyWooWebhookSignature,
  WOO_ACCEPTED_TOPICS,
  WOO_DELIVERY_KEY_FIELD,
  WOO_ORDER_EVENT,
  WOO_SAGA_TYPE,
  wooDeliveryKey,
  wooEventId,
} from "@/server/woocommerce/ingress";
import {
  formatQuarantineAlert,
  parseWooOrderWebhook,
  type SkuIngressIssue,
} from "@/server/woocommerce/ingress.schema";
import { classifyWooOrder } from "@/server/woocommerce/order-state";
import { fingerprintWooOrder } from "@/server/woocommerce/order-fingerprint";
import {
  decidePaidDelivery,
  markBaselineEnqueued,
} from "@/server/woocommerce/paid-baseline";
import {
  quarantineOnce,
  resolvePendingReviewForOrder,
} from "@/server/woocommerce/quarantine-store";
import { hubResolveDeps, resolveWooOrder } from "@/server/woocommerce/sku-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logRoute(level: "log" | "error", tag: string, fields: Record<string, unknown>): void {
  // Never include the secret, the signature or the order payload (PII).
  console[level](JSON.stringify({ tag, route: "woocommerce-webhook", ...fields }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function readOrderId(parsedJson: unknown): string | null {
  if (!parsedJson || typeof parsedJson !== "object") return null;
  const id = (parsedJson as { id?: unknown }).id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

function resolutionPathFor(externalId: string): string {
  return `/admin/quarantine?source=woocommerce&externalId=${encodeURIComponent(externalId)}`;
}

async function alertBestEffort(input: Parameters<typeof sendOhCrapAlert>[0]): Promise<void> {
  // The order is already persisted; an undeliverable alert must not turn a good delivery into a
  // non-2xx. It is logged loudly instead.
  try {
    const result = await sendOhCrapAlert(input);
    if (!result.ok) {
      logRoute("error", "woo-route-alert-undelivered", {
        externalId: input.externalId,
        reason: input.reason,
        error: result.error,
      });
    }
  } catch (error) {
    logRoute("error", "woo-route-alert-undelivered", {
      externalId: input.externalId,
      reason: input.reason,
      error: errorText(error),
    });
  }
}

/** The audit row is bookkeeping once the real outcome is persisted: a failure is logged, not fatal. */
async function markAudit(
  deliveryKey: string,
  orderId: string,
  status: "processed" | "failed",
  message: string,
): Promise<void> {
  try {
    await updateIncomingWebhookStatus(deliveryKey, status, message);
  } catch (error) {
    logRoute("error", "woo-audit-mark-failed", { orderId, status, error: errorText(error) });
  }
}

/** Persist a `pending_review` quarantine row, alert once, and answer 202. */
async function quarantineInvalid(input: {
  externalId: string;
  rawPayload: unknown;
  issues: SkuIngressIssue[];
}): Promise<NextResponse> {
  let result: Awaited<ReturnType<typeof quarantineOnce>>;
  try {
    // Persist BEFORE alerting so the order is never lost on the floor.
    result = await quarantineOnce({ ...input, status: "pending_review" });
  } catch (error) {
    logRoute("error", "woo-quarantine-persist-failed", {
      externalId: input.externalId,
      error: errorText(error),
    });
    return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
  }
  if (result === "inserted") {
    await alertBestEffort({
      reason: "validation_failed",
      source: "woocommerce",
      externalId: input.externalId,
      message: formatQuarantineAlert({ orderId: input.externalId, issues: input.issues }),
      resolutionPath: resolutionPathFor(input.externalId),
    });
  }
  return NextResponse.json({ accepted: true, quarantined: true }, { status: 202 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    logRoute("error", "woo-webhook-not-configured", {
      message: "WOOCOMMERCE_WEBHOOK_SECRET is not set; deliveries are refused.",
    });
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  if (!verifyWooWebhookSignature(rawBody, req.headers.get("x-wc-webhook-signature"), secret)) {
    logRoute("error", "woo-webhook-invalid-signature", {
      deliveryId: req.headers.get("x-wc-webhook-delivery-id") ?? null,
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  if (isWooPingBody(rawBody)) {
    return NextResponse.json({ pong: true }, { status: 200 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { errors: [{ path: "(root)", message: "Body must be valid JSON" }] },
      { status: 400 },
    );
  }

  const topic = req.headers.get("x-wc-webhook-topic")?.trim() ?? "";
  if (!WOO_ACCEPTED_TOPICS.has(topic)) {
    return NextResponse.json({ ignored: true, reason: "topic" }, { status: 200 });
  }

  const deliveryKey = wooDeliveryKey(req.headers, rawBody);
  const parsed = parseWooOrderWebhook(parsedJson);

  if (!parsed.ok) {
    const externalId = readOrderId(parsedJson) ?? deliveryKey;
    return quarantineInvalid({ externalId, rawPayload: parsedJson, issues: parsed.issues });
  }

  const order = parsed.data;
  const orderId = String(order.id);
  const orderClass = classifyWooOrder(order);

  // A cancelled/refunded/failed order whose saga already exists was paid at some point, even if
  // the payload no longer says so. That is a human case, never an automatic Katana delete.
  let terminalAfterPaid = orderClass === "terminal_after_paid_needs_human";
  if (orderClass === "terminal_unpaid") {
    try {
      terminalAfterPaid = (await sagaStore.get(WOO_SAGA_TYPE, orderId)) !== null;
    } catch (error) {
      logRoute("error", "woo-saga-lookup-failed", { orderId, error: errorText(error) });
      return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
    }
  }

  const isPaid = orderClass === "paid";
  let audit: "inserted" | "duplicate";
  try {
    audit = await insertIncomingWebhookOnce({
      source: "woocommerce",
      eventName: topic,
      idempotencyKey: deliveryKey,
      payload: order,
      status: isPaid ? "received" : "processed",
      errorMessage: isPaid
        ? undefined
        : terminalAfterPaid
          ? `Order ${orderId} is ${String(order.status)} after payment; Katana NOT touched, human review.`
          : `Order ${orderId} is ${orderClass} (${String(order.status)}); no Katana work.`,
    });
  } catch (error) {
    logRoute("error", "woo-audit-persist-failed", { orderId, error: errorText(error) });
    return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
  }

  if (terminalAfterPaid) {
    if (audit === "inserted") {
      await alertBestEffort({
        reason: "unknown",
        source: "woocommerce",
        externalId: orderId,
        message: `WooCommerce order ${orderId}: paid order changed to ${String(order.status)}, manual review. Katana order NOT touched.`,
        resolutionPath: resolutionPathFor(orderId),
      });
    }
    return NextResponse.json({ accepted: true, needsHuman: true }, { status: 200 });
  }

  if (orderClass === "terminal_unpaid") {
    return NextResponse.json({ accepted: true, ignored: true, reason: "terminal_unpaid" }, { status: 200 });
  }

  if (orderClass === "awaiting_payment") {
    // Validate early so a bad SKU or finish is visible before the customer pays. A valid order
    // resolves this quarantine row when the paid delivery arrives.
    let early: Awaited<ReturnType<typeof resolveWooOrder>>;
    try {
      early = await resolveWooOrder(order, hubResolveDeps(), { requireKatanaIds: false });
    } catch (error) {
      logRoute("error", "woo-resolve-failed", { orderId, error: errorText(error) });
      return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
    }
    if (!early.ok) {
      return quarantineInvalid({ externalId: orderId, rawPayload: order, issues: early.issues });
    }
    return NextResponse.json({ accepted: true, awaiting_payment: true }, { status: 200 });
  }

  // ---- Paid ------------------------------------------------------------------------------
  const fingerprint = fingerprintWooOrder(order);
  let decision: Awaited<ReturnType<typeof decidePaidDelivery>>;
  try {
    decision = await decidePaidDelivery({ orderId, deliveryKey, fingerprint, topic });
  } catch (error) {
    logRoute("error", "woo-baseline-failed", { orderId, error: errorText(error) });
    return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
  }

  if (decision.kind === "unchanged") {
    await markAudit(
      deliveryKey,
      orderId,
      "processed",
      `Order ${orderId}: no manufacturing change since the paid delivery; acknowledged.`,
    );
    return NextResponse.json({ accepted: true, unchanged: true }, { status: 200 });
  }

  if (decision.kind === "edited") {
    const issues: SkuIngressIssue[] = [
      {
        path: "(order)",
        message:
          "Order changed after payment (line items, finishes, shipping address, or customer). The paid order is already in the pipeline and is NOT reprocessed. Review by hand.",
      },
      { path: "(fingerprint)", message: fingerprint },
    ];
    let result: Awaited<ReturnType<typeof quarantineOnce>>;
    try {
      result = await quarantineOnce({
        externalId: orderId,
        rawPayload: order,
        issues,
        status: "post_payment_edit",
      });
    } catch (error) {
      logRoute("error", "woo-quarantine-persist-failed", { orderId, error: errorText(error) });
      return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
    }
    if (result !== "unchanged") {
      await alertBestEffort({
        reason: "unknown",
        source: "woocommerce",
        externalId: orderId,
        message: `WooCommerce order ${orderId} was edited AFTER payment. Katana was NOT updated and the order was NOT reprocessed. Compare the edit against the Katana sales order by hand.`,
        resolutionPath: resolutionPathFor(orderId),
      });
    }
    await markAudit(deliveryKey, orderId, "processed", `Order ${orderId}: post-payment edit quarantined.`);
    return NextResponse.json(
      { accepted: true, quarantined: true, reason: "post_payment_edit" },
      { status: 202 },
    );
  }

  // first | redelivery: validate against the live hub database before enqueueing.
  let resolution: Awaited<ReturnType<typeof resolveWooOrder>>;
  try {
    resolution = await resolveWooOrder(order, hubResolveDeps(), { requireKatanaIds: false });
  } catch (error) {
    logRoute("error", "woo-resolve-failed", { orderId, error: errorText(error) });
    return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
  }
  if (!resolution.ok) {
    const response = await quarantineInvalid({
      externalId: orderId,
      rawPayload: order,
      issues: resolution.issues,
    });
    if (response.status === 202) {
      await markAudit(deliveryKey, orderId, "failed", `Order ${orderId} quarantined: validation failed.`);
    }
    return response;
  }

  // ALWAYS send, even when the audit row was a duplicate: Inngest dedupes by event id, so a
  // re-send is free, whereas short-circuiting would lose the order whenever the first delivery
  // inserted the row and `inngest.send` then failed.
  try {
    await inngest.send({
      id: wooEventId(order),
      name: WOO_ORDER_EVENT,
      data: { ...order, [WOO_DELIVERY_KEY_FIELD]: deliveryKey },
    });
  } catch (error) {
    const message = `inngest.send failed: ${errorText(error)}`;
    logRoute("error", "woo-enqueue-failed", { orderId, error: message });
    await markAudit(deliveryKey, orderId, "failed", message);
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  try {
    await markBaselineEnqueued({ orderId, deliveryKey, fingerprint });
  } catch (error) {
    // The event is queued (Inngest dedupes a re-send). A 500 makes Woo redeliver, which re-pins
    // the baseline; answering 2xx here would leave an edit undetectable.
    logRoute("error", "woo-baseline-pin-failed", { orderId, error: errorText(error) });
    return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
  }

  try {
    await resolvePendingReviewForOrder(orderId);
  } catch (error) {
    // The order is accepted and queued; a stale review row is cosmetic and visible in the log.
    logRoute("error", "woo-quarantine-autoresolve-failed", { orderId, error: errorText(error) });
  }

  return NextResponse.json(
    { accepted: true, orderId: order.id, pipelineMode: getOrderPipelineMode() },
    { status: 202 },
  );
}
