/**
 * POST /api/webhooks/katana
 *
 * Verifies Katana's `x-sha2-signature` (HMAC-SHA256 of the raw body, key
 * `KATANA_WEBHOOK_SECRET`). Every signed, parseable delivery first writes one append-only
 * `incoming_webhooks` row (source `katana`, per-delivery key; the sagas own de-duplication)
 * and ends by marking it `processed` or `failed`. The route makes zero Katana calls.
 *
 * - `stock_adjustment.deleted` / `sales_order.deleted` release a matching HOLD- ledger row.
 * - `variant.updated` heals the local SKU inline when the body carries it, otherwise enqueues
 *   `katana/variant.heal.requested`.
 * - `purchase_order.received` / `purchase_order.partially_received` enqueue the QBO A/P
 *   Vendor Bill saga and revalidate showroom stock views.
 * - `sales_order.updated|packed|delivered` enqueue `katana/sales_order.status_changed`.
 * - `manufacturing_order.done` enqueues `katana/manufacturing_order.done`.
 * Other events are acknowledged and not written beyond the audit row.
 *
 * Status contract with Katana: 400 for a body that can never succeed, 401 for a bad
 * signature, 500 for any other fault (including a failed audit insert or enqueue).
 * Katana retries 5xx. Response bodies carry a `ref`, never provider or driver text.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { KATANA_PO_RECEIVED_EVENT } from "@/inngest/katana-po-received";
import { logError, logStructured } from "@/lib/log/structured";
import { logPimAudit } from "@/lib/pim-audit";
import {
  healKatanaVariantSku,
  readHoldDeletion,
  readVariantUpdate,
  verifyKatanaWebhookSignature,
} from "@/server/katana/variant-webhook";
import {
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
  KATANA_VARIANT_HEAL_EVENT,
  readKatanaEnvelope,
  readManufacturingOrderDone,
  readPurchaseOrderReceipt,
  readSalesOrderStatus,
} from "@/server/katana/webhook-events";
import { inngestEventId } from "@/server/sre/idempotency";
import { releaseDeletedHoldDocument } from "@/server/stock/release-hold";
import {
  insertIncomingWebhookOnce,
  updateIncomingWebhookStatus,
} from "@/server/webhooks/incoming-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome = { response: Response; status: "processed" | "failed"; message?: string };

function done(body: unknown, init?: { status: number }): Outcome {
  return { response: NextResponse.json(body, init), status: "processed" };
}

function rejected(message: string, body: unknown, status: number): Outcome {
  return { response: NextResponse.json(body, { status }), status: "failed", message };
}

function invalidEvent(message: string): Outcome {
  return rejected(message, { error: "invalid_event", message }, 400);
}

async function dispatch(payload: unknown, auditKey: string): Promise<Outcome> {
  const deletion = readHoldDeletion(payload);
  if (deletion.kind === "invalid") return invalidEvent(deletion.message);
  if (deletion.kind === "deleted") {
    const outcome = await releaseDeletedHoldDocument({
      documentKind: deletion.documentKind,
      number: deletion.number,
      documentId: deletion.documentId,
    });
    if (outcome === "failed") {
      logStructured("error", "katana-webhook-hold-release-failed", {
        documentKind: deletion.documentKind,
        status: 500,
      });
      return rejected(
        "hold release failed",
        { error: "release_failed", message: "Could not release the showroom hold." },
        500,
      );
    }
    if (outcome === "released") {
      revalidatePath("/showroom");
      revalidatePath("/embed/showroom");
    }
    return done({ ok: true, released: outcome === "released" });
  }

  const update = readVariantUpdate(payload);
  if (update.kind === "invalid") return invalidEvent(update.message);
  if (update.kind === "update") {
    if (!update.sku) {
      await inngest.send({
        id: inngestEventId("katana:variant", update.variantId, auditKey),
        name: KATANA_VARIANT_HEAL_EVENT,
        data: { variantId: update.variantId },
      });
      return done({ ok: true, queued: true, variantId: update.variantId });
    }
    const sku = update.sku;
    const result = await healKatanaVariantSku(update.variantId, sku);
    if (result.conflict) {
      logStructured("error", "katana-webhook-sku-conflict", { variantId: update.variantId, sku });
      return done({ ok: true, healed: false, reason: "sku_conflict" });
    }
    if (result.healed) {
      logStructured("info", "katana-webhook-sku-healed", { variantId: update.variantId, sku });
      await logPimAudit({
        operatorEmail: "katana-webhook@ccpatio.com",
        operatorName: "Katana webhook",
        globalSku: sku,
        action: "auto_heal_sku",
        field: "sku",
        newValue: sku,
      });
      revalidatePath("/admin/logistics");
      revalidatePath("/admin/dictionary");
    }
    return done({ ok: true, healed: result.healed });
  }

  const poReceipt = readPurchaseOrderReceipt(payload);
  if (poReceipt.kind === "invalid") return invalidEvent(poReceipt.message);
  if (poReceipt.kind === "received") {
    await inngest.send({
      id: inngestEventId(
        "katana:po",
        poReceipt.purchaseOrderId,
        `${poReceipt.action}:${auditKey}`,
      ),
      name: KATANA_PO_RECEIVED_EVENT,
      data: {
        purchaseOrderId: poReceipt.purchaseOrderId,
        orderNo: poReceipt.orderNo,
        action: poReceipt.action,
      },
    });
    revalidatePath("/showroom");
    revalidatePath("/embed/showroom");
    revalidatePath("/tools/stock-checker");
    return done({
      ok: true,
      queued: true,
      action: poReceipt.action,
      purchaseOrderId: poReceipt.purchaseOrderId,
    });
  }

  const soStatus = readSalesOrderStatus(payload);
  if (soStatus.kind === "invalid") return invalidEvent(soStatus.message);
  if (soStatus.kind === "sales_order_status") {
    await inngest.send({
      id: inngestEventId("katana:so", soStatus.salesOrderId, `${soStatus.action}:${auditKey}`),
      name: KATANA_SO_STATUS_EVENT,
      data: { salesOrderId: soStatus.salesOrderId, action: soStatus.action, source: "webhook" },
    });
    return done({ ok: true, queued: true, action: soStatus.action });
  }

  const moDone = readManufacturingOrderDone(payload);
  if (moDone.kind === "invalid") return invalidEvent(moDone.message);
  if (moDone.kind === "manufacturing_order_done") {
    await inngest.send({
      id: inngestEventId(
        "katana:mo",
        moDone.manufacturingOrderId,
        `manufacturing_order.done:${auditKey}`,
      ),
      name: KATANA_MO_DONE_EVENT,
      data: { manufacturingOrderId: moDone.manufacturingOrderId },
    });
    return done({ ok: true, queued: true, action: "manufacturing_order.done" });
  }

  return done({ ok: true, ignored: true });
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.KATANA_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const signature = req.headers.get("x-sha2-signature");
  if (!verifyKatanaWebhookSignature(rawBody, signature, secret)) {
    logStructured("warn", "katana-webhook-invalid-signature", { status: 401 });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    const ref = logError("katana-webhook-invalid-json", error, { status: 400 });
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be valid JSON", ref },
      { status: 400 },
    );
  }

  const envelope = readKatanaEnvelope(payload);
  const eventName = envelope.action || "unknown";
  const auditKey = `katana:${eventName}:${envelope.objectId ?? "noid"}:${randomUUID()}`;
  try {
    await insertIncomingWebhookOnce({
      source: "katana",
      eventName,
      idempotencyKey: auditKey,
      payload,
      status: "received",
    });
  } catch (error) {
    const ref = logError("katana-webhook-audit-insert-failed", error, { eventName, status: 500 });
    return NextResponse.json({ error: "persistence_failed", ref }, { status: 500 });
  }

  let outcome: Outcome;
  try {
    outcome = await dispatch(payload, auditKey);
  } catch (error) {
    const ref = logError("katana-webhook-failed", error, { eventName, status: 500 });
    await updateIncomingWebhookStatus(auditKey, "failed", `internal_error ref=${ref}`);
    return NextResponse.json({ error: "internal_error", ref }, { status: 500 });
  }
  await updateIncomingWebhookStatus(auditKey, outcome.status, outcome.message);
  return outcome.response;
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    const ref = logError("katana-webhook-failed", error, { status: 500 });
    return NextResponse.json({ error: "internal_error", ref }, { status: 500 });
  }
}
