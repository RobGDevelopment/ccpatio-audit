"use server";

/**
 * Phase B1: operator actions for quarantined WooCommerce orders.
 *
 *   replayWooQuarantinedOrder      `pending_review` only: re-validate against the live hub DB and,
 *                                  when clean, enqueue the paid-order event exactly as the webhook
 *                                  route would. Refuses when the order is unpaid, already has a
 *                                  saga, or was already enqueued by a delivery.
 *   acknowledgeWooPostPaymentEdit  `post_payment_edit` only: the operator has compared the edit
 *                                  with the Katana order by hand.
 *   discardWooQuarantine           either status: close without processing (reason required).
 *
 * No Katana, QBO or Clover call happens here. Replay only sends the same Inngest event the
 * webhook route sends (idempotent by event id); the saga does the Katana work.
 */
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { logPimAudit, resolvePimOperator } from "@/lib/pim-audit";
import { sagaStore } from "@/server/sre/saga-store";
import { insertIncomingWebhookOnce } from "@/server/webhooks/incoming-log";
import {
  WOO_DELIVERY_KEY_FIELD,
  WOO_ORDER_EVENT,
  WOO_SAGA_TYPE,
  wooEventId,
} from "@/server/woocommerce/ingress";
import { parseWooOrderWebhook, type SkuIngressIssue } from "@/server/woocommerce/ingress.schema";
import { fingerprintWooOrder } from "@/server/woocommerce/order-fingerprint";
import { classifyWooOrder } from "@/server/woocommerce/order-state";
import { decidePaidDelivery, markBaselineEnqueued } from "@/server/woocommerce/paid-baseline";
import {
  getWooQuarantineRow,
  transitionWooQuarantine,
  updatePendingIssues,
} from "@/server/woocommerce/quarantine-store";
import { hubResolveDeps, resolveWooOrder } from "@/server/woocommerce/sku-resolver";

export type WooQuarantineActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      error: string;
      code?: "not_found" | "conflict" | "validation" | "failed";
      issues?: SkuIngressIssue[];
    };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function refresh(): void {
  revalidatePath("/admin/quarantine");
}

export async function replayWooQuarantinedOrder(
  id: number,
): Promise<WooQuarantineActionResult> {
  const operator = await resolvePimOperator();

  const row = await getWooQuarantineRow(id);
  if (!row) return { ok: false, error: "Quarantine row not found.", code: "not_found" };
  if (row.status !== "pending_review") {
    return {
      ok: false,
      error: `Row is ${row.status}; only pending_review rows can be replayed.`,
      code: "conflict",
    };
  }

  const parsed = parseWooOrderWebhook(row.rawPayload);
  if (!parsed.ok) {
    return {
      ok: false,
      error: "The stored payload is not a valid WooCommerce order. Discard it.",
      code: "validation",
      issues: parsed.issues,
    };
  }
  const order = parsed.data;
  const orderId = String(order.id);

  const orderClass = classifyWooOrder(order);
  if (orderClass !== "paid") {
    return {
      ok: false,
      error: `Order ${orderId} is not paid (${String(order.status)}). Only paid orders are replayed. WooCommerce redelivers when it is paid; discard this row if it is no longer needed.`,
      code: "conflict",
    };
  }

  try {
    if ((await sagaStore.get(WOO_SAGA_TYPE, orderId)) !== null) {
      return {
        ok: false,
        error: `Order ${orderId} already has a saga run. It was processed; it cannot be replayed.`,
        code: "conflict",
      };
    }

    const resolution = await resolveWooOrder(order, hubResolveDeps(), { requireKatanaIds: false });
    if (!resolution.ok) {
      await updatePendingIssues(id, resolution.issues);
      return {
        ok: false,
        error: "The order still fails validation against the hub. Fix the data, then replay.",
        code: "validation",
        issues: resolution.issues,
      };
    }

    const deliveryKey = `woo-replay:${id}`;
    const fingerprint = fingerprintWooOrder(order);

    await insertIncomingWebhookOnce({
      source: "woocommerce",
      eventName: "replay",
      idempotencyKey: deliveryKey,
      payload: order,
      status: "received",
    });

    const decision = await decidePaidDelivery({
      orderId,
      deliveryKey,
      fingerprint,
      topic: "replay",
    });
    if (decision.kind === "unchanged" || decision.kind === "edited") {
      return {
        ok: false,
        error: `Order ${orderId} was already enqueued by a webhook delivery; replay refused.`,
        code: "conflict",
      };
    }

    await inngest.send({
      id: wooEventId(order),
      name: WOO_ORDER_EVENT,
      data: { ...order, [WOO_DELIVERY_KEY_FIELD]: deliveryKey },
    });
    await markBaselineEnqueued({ orderId, deliveryKey, fingerprint });

    const closed = await transitionWooQuarantine({
      id,
      from: "pending_review",
      to: "resolved",
    });
    await logPimAudit({
      operatorEmail: operator.email,
      action: "woo_quarantine_replay",
      field: "status",
      oldValue: "pending_review",
      newValue: `resolved (order ${orderId})`,
    });
    refresh();
    return {
      ok: true,
      message: closed
        ? `Order ${orderId} validated and queued.`
        : `Order ${orderId} validated and queued (the row had already been closed).`,
    };
  } catch (error) {
    console.error("[replayWooQuarantinedOrder] failed", error);
    return { ok: false, error: `Replay failed: ${errorText(error)}`, code: "failed" };
  }
}

export async function acknowledgeWooPostPaymentEdit(
  id: number,
): Promise<WooQuarantineActionResult> {
  const operator = await resolvePimOperator();
  const row = await getWooQuarantineRow(id);
  if (!row) return { ok: false, error: "Quarantine row not found.", code: "not_found" };
  if (row.status !== "post_payment_edit") {
    return {
      ok: false,
      error: `Row is ${row.status}; only post_payment_edit rows can be acknowledged.`,
      code: "conflict",
    };
  }
  const changed = await transitionWooQuarantine({
    id,
    from: "post_payment_edit",
    to: "resolved",
  });
  if (!changed) {
    return { ok: false, error: "Row was already handled.", code: "conflict" };
  }
  await logPimAudit({
    operatorEmail: operator.email,
    action: "woo_quarantine_acknowledge",
    field: "status",
    oldValue: "post_payment_edit",
    newValue: `resolved (order ${row.externalId})`,
  });
  refresh();
  return { ok: true, message: `Edit on order ${row.externalId} acknowledged.` };
}

export async function discardWooQuarantine(
  id: number,
  reason: string,
): Promise<WooQuarantineActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, error: "A discard reason is required.", code: "validation" };
  }
  const operator = await resolvePimOperator();
  const row = await getWooQuarantineRow(id);
  if (!row) return { ok: false, error: "Quarantine row not found.", code: "not_found" };
  if (row.status !== "pending_review" && row.status !== "post_payment_edit") {
    return { ok: false, error: `Row is already ${row.status}.`, code: "conflict" };
  }
  const changed = await transitionWooQuarantine({
    id,
    from: row.status,
    to: "discarded",
    issues: [
      ...row.issues,
      { path: "(resolution)", message: `Discarded by ${operator.email}: ${trimmed}` },
    ],
  });
  if (!changed) {
    return { ok: false, error: "Row was already handled.", code: "conflict" };
  }
  await logPimAudit({
    operatorEmail: operator.email,
    action: "woo_quarantine_discard",
    field: "status",
    oldValue: row.status,
    newValue: `discarded: ${trimmed}`,
  });
  refresh();
  return { ok: true, message: `Order ${row.externalId} discarded.` };
}
