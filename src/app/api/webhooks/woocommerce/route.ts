/**
 * POST /api/webhooks/woocommerce
 *
 * Roadmap step 6 (FINAL_INTEGRATION_ROADMAP.md, CLAUDE.md): paid WooCommerce orders enter the
 * hub here. This SUPERSEDES the earlier 410 "retired" stub described in
 * docs/MDM_MASTER_BLUEPRINT.md Phase 0.
 *
 * The route is a thin, fast ingress: verify -> validate -> audit -> classify -> enqueue.
 * It performs NO Katana, QBO or Clover I/O. The Inngest function `process-woocommerce-order`
 * (src/inngest/woo-order.ts) does the heavy work behind ORDER_PIPELINE_MODE (default `log`,
 * i.e. a dry run) and LEDGER_PIPELINE_MODE (default `log`).
 *
 * Non-2xx is reserved for: missing secret (503), bad signature (401), unparseable JSON (400)
 * and a persistence/enqueue failure (500). WooCommerce disables a webhook after repeated
 * non-2xx deliveries, so a SKU validation problem is quarantined and acknowledged (202).
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getDb } from "@/server/db/client";
import { quarantined_orders } from "@/server/db/schema";
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

/**
 * One `pending_review` row per order across redeliveries: refresh the existing row instead of
 * piling up duplicates. Returns whether a NEW row was created (alert only then).
 */
async function quarantineOnce(input: {
  externalId: string;
  rawPayload: unknown;
  issues: SkuIngressIssue[];
}): Promise<"inserted" | "updated"> {
  const db = getDb();
  const [existing] = await db
    .select({ id: quarantined_orders.id })
    .from(quarantined_orders)
    .where(
      and(
        eq(quarantined_orders.source, "woocommerce"),
        eq(quarantined_orders.external_id, input.externalId),
        eq(quarantined_orders.status, "pending_review"),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(quarantined_orders)
      .set({
        raw_payload: input.rawPayload as object,
        issues: input.issues,
        updated_at: new Date(),
      })
      .where(eq(quarantined_orders.id, existing.id));
    return "updated";
  }

  await db.insert(quarantined_orders).values({
    source: "woocommerce",
    external_id: input.externalId,
    raw_payload: input.rawPayload as object,
    issues: input.issues,
    updated_at: new Date(),
  });
  return "inserted";
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
    let quarantine: "inserted" | "updated";
    try {
      // Persist BEFORE alerting so the order is never lost on the floor.
      quarantine = await quarantineOnce({ externalId, rawPayload: parsedJson, issues: parsed.issues });
    } catch (error) {
      logRoute("error", "woo-quarantine-persist-failed", { externalId, error: errorText(error) });
      return NextResponse.json({ error: "persistence_failed" }, { status: 500 });
    }
    if (quarantine === "inserted") {
      await alertBestEffort({
        reason: "validation_failed",
        source: "woocommerce",
        externalId,
        message: formatQuarantineAlert({ orderId: externalId, issues: parsed.issues }),
        resolutionPath: `/admin/quarantine?source=woocommerce&externalId=${encodeURIComponent(externalId)}`,
      });
    }
    return NextResponse.json({ accepted: true, quarantined: true }, { status: 202 });
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
        resolutionPath: `/admin/quarantine?source=woocommerce&externalId=${encodeURIComponent(orderId)}`,
      });
    }
    return NextResponse.json({ accepted: true, needsHuman: true }, { status: 200 });
  }

  if (orderClass === "awaiting_payment") {
    return NextResponse.json({ accepted: true, awaiting_payment: true }, { status: 200 });
  }
  if (orderClass === "terminal_unpaid") {
    return NextResponse.json({ accepted: true, ignored: true, reason: "terminal_unpaid" }, { status: 200 });
  }

  // Paid. ALWAYS send, even when the audit row was a duplicate: Inngest dedupes by event id,
  // so a re-send is free, whereas short-circuiting would lose the order whenever the first
  // delivery inserted the row and `inngest.send` then failed.
  try {
    await inngest.send({
      id: wooEventId(order),
      name: WOO_ORDER_EVENT,
      data: { ...order, [WOO_DELIVERY_KEY_FIELD]: deliveryKey },
    });
  } catch (error) {
    const message = `inngest.send failed: ${errorText(error)}`;
    logRoute("error", "woo-enqueue-failed", { orderId, error: message });
    try {
      await updateIncomingWebhookStatus(deliveryKey, "failed", message);
    } catch (markError) {
      logRoute("error", "woo-audit-mark-failed-failed", { orderId, error: errorText(markError) });
    }
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { accepted: true, orderId: order.id, pipelineMode: getOrderPipelineMode() },
    { status: 202 },
  );
}
