/**
 * Phase 10 Task 7 — `process-woocommerce-order`: the paid-order saga (roadmap step 6).
 *
 * Everything routes through the Phase 9 SRE primitives:
 *   - global DLQ (src/inngest/dlq.ts) is the ONLY alert authority; there is NO `onFailure`
 *     alert here, so one exhausted run produces exactly one `dlq_events` row and one alert,
 *   - `KATANA_TENANT_CONCURRENCY` + `runKatanaStep`/`katanaFetch` (shared 1 req/s bucket),
 *   - the saga ledger (`saga_runs`) and `planCompensation` (never a delete for a paid order).
 *
 * Gates (both default to `log`, fail closed, evaluated at RUNTIME, never at import):
 *   - ORDER_PIPELINE_MODE: only `live` may touch Katana. `log`/`approve` = dry run, zero
 *     Katana calls, saga left PENDING/`dry_run_logged` so the order is still processable after
 *     the live flip (replay tooling is roadmap step 9, out of scope).
 *   - LEDGER_PIPELINE_MODE: see ledger-leg.ts (marker only; no QBO in this phase).
 *
 * This module (and everything it imports from src/server/woocommerce) must not import QBO.
 */
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { runKatanaStep } from "@/inngest/katana-step";
import { KatanaApiError, mapWooOrderToKatanaSalesOrder } from "@/lib/katana";
import { getLedgerPipelineMode, type LedgerPipelineMode } from "@/server/pipeline/ledger-mode";
import {
  canMutateKatanaOrders,
  getOrderPipelineMode,
  pipelineModeLabel,
  type OrderPipelineMode,
} from "@/server/pipeline/mode";
import {
  IDEMPOTENCY_BY_EVENT_ID,
  katanaOrderNo,
} from "@/server/sre/idempotency";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import {
  assertNeverDeletePaid,
  planCompensation,
  type SagaFailedLeg,
} from "@/server/sre/saga";
import { sagaStore, type SagaStore } from "@/server/sre/saga-store";
import { updateIncomingWebhookStatus } from "@/server/webhooks/incoming-log";
import {
  WOO_DELIVERY_KEY_FIELD,
  WOO_ORDER_EVENT,
  WOO_SAGA_TYPE,
} from "@/server/woocommerce/ingress";
import {
  parseWooOrderWebhook,
  type WooOrderWebhook,
} from "@/server/woocommerce/ingress.schema";
import {
  defaultWooKatanaDeps,
  isOwnWooSalesOrder,
  WOO_MO_LISTING_LIMIT,
  type WooKatanaDeps,
} from "@/server/woocommerce/katana-deps";
import { runWooLedgerLeg } from "@/server/woocommerce/ledger-leg";

export type WooSagaStep = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
};

export type WooSagaDeps = {
  store: SagaStore;
  katana: WooKatanaDeps;
  /** Updates the `incoming_webhooks` audit row (keyed by the delivery key). */
  updateAudit: (
    idempotencyKey: string,
    status: "processed" | "failed",
    message?: string,
  ) => Promise<void>;
  /** Both gates, read once per run and memoized in a step. */
  getModes: () => { orderMode: OrderPipelineMode; ledgerMode: LedgerPipelineMode };
  now: () => Date;
};

export function defaultWooSagaDeps(): WooSagaDeps {
  return {
    store: sagaStore,
    katana: defaultWooKatanaDeps,
    updateAudit: updateIncomingWebhookStatus,
    getModes: () => ({
      orderMode: getOrderPipelineMode(),
      ledgerMode: getLedgerPipelineMode(),
    }),
    now: () => new Date(),
  };
}

/**
 * 4xx from Katana (bad SKU, bad quantity, auth) cannot be fixed by retrying: non-retriable, so
 * it goes straight to manual intervention + the DLQ. 408/409/429 stay retryable (a 409 on
 * create means "already exists"; the retry finds it via the order_no lookup). 5xx, timeouts and
 * throttle errors propagate untouched so Inngest retries them (`runKatanaStep` turns a 429 into
 * a `RetryAfterError` and the throttle's fatal codes into `NonRetriableError`).
 */
export function toWooSagaError(error: unknown): unknown {
  if (error instanceof NonRetriableError) return error;
  if (
    error instanceof KatanaApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409 &&
    error.status !== 429
  ) {
    return new NonRetriableError(error.message, { cause: error });
  }
  return error;
}

async function wooKatanaCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toWooSagaError(error);
  }
}

function readDeliveryKey(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[WOO_DELIVERY_KEY_FIELD];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function paidAtFor(order: WooOrderWebhook, now: Date): Date {
  if (typeof order.date_paid === "string" && order.date_paid.trim()) {
    const parsed = new Date(order.date_paid);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now;
}

type SalesOrderResult = { salesOrderId: number; rowIds: number[]; created: boolean };

async function ensureSalesOrder(
  order: WooOrderWebhook,
  orderNo: string,
  katana: WooKatanaDeps,
): Promise<SalesOrderResult> {
  const existing = await katana.findSalesOrderByOrderNo(orderNo);

  if (existing) {
    // PROVENANCE FIRST: never adopt (or write to) a foreign sales order.
    if (!isOwnWooSalesOrder(existing, order.id)) {
      throw new NonRetriableError(
        `Katana already has sales order ${orderNo} that does not belong to WooCommerce order ${order.id} ` +
          "(order_no collision). Not adopting it; manual review required.",
      );
    }
    const salesOrderId = Number(existing.id);
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
      throw new KatanaApiError(`Katana sales order ${orderNo} has no usable id.`, { status: 422 });
    }
    const rowIds = await katana.getSalesOrderRowIds(existing);
    return { salesOrderId, rowIds, created: false };
  }

  const payload = { ...mapWooOrderToKatanaSalesOrder(order), idempotencyKey: orderNo };
  const created = await katana.createSalesOrder(payload);
  return { salesOrderId: created.salesOrderId, rowIds: created.salesOrderRowIds, created: true };
}

type MoRowResult = { rowId: number; moId: number; reused: boolean };

export async function runWooOrderSaga({
  event,
  step,
  deps = defaultWooSagaDeps(),
}: {
  event: { data: unknown };
  step: WooSagaStep;
  deps?: WooSagaDeps;
}) {
  const parsed = parseWooOrderWebhook(event.data);
  if (!parsed.ok) {
    const detail = parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    // The route already quarantines invalid orders; reaching here is a producer bug.
    throw new NonRetriableError(`Invalid WooCommerce order payload: ${detail}`);
  }
  const order = parsed.data;
  const orderKey = String(order.id);
  const orderNo = katanaOrderNo("woo", order.id, { number: order.number });
  const deliveryKey = readDeliveryKey(event.data);
  const lineCount = order.line_items.length;

  const markAudit = async (status: "processed" | "failed", message?: string) => {
    if (deliveryKey) await deps.updateAudit(deliveryKey, status, message);
  };

  // 1. saga-start: insert-once (the unique index decides a race), then read back.
  const start = await step.run("saga-start", async () => {
    const { row, inserted } = await deps.store.insertOnce({
      sagaType: WOO_SAGA_TYPE,
      correlationKey: orderKey,
      status: "IN_PROGRESS",
      paidAt: paidAtFor(order, deps.now()),
    });
    return { status: row.status, inserted };
  });

  if (start.status === "COMPLETED") {
    return { ok: true as const, duplicate: true as const, orderId: order.id, orderNo };
  }
  if (
    start.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" ||
    start.status === "COMPENSATING" ||
    start.status === "COMPENSATED"
  ) {
    // Already a human case; the DLQ/earlier alert covers it. No re-alert, no action.
    return {
      ok: true as const,
      skipped: true as const,
      reason: `saga_${start.status}`,
      orderId: order.id,
      orderNo,
    };
  }

  // 2. Mode gates, read once and memoized so one run cannot straddle a flip.
  const modes = await step.run("resolve-modes", async () => deps.getModes());
  const mode = modes.orderMode;

  if (!canMutateKatanaOrders(mode)) {
    await step.run("woo-dry-run", async () => {
      console.log(
        JSON.stringify({
          tag: "woo-order-dry-run",
          orderId: order.id,
          orderNo,
          lineCount,
          mode,
        }),
      );
      // Never poison the saga: PENDING/dry_run_logged keeps the order processable after the
      // live flip. Do not clobber a row that is already further along.
      if (start.inserted || start.status === "PENDING") {
        await deps.store.setStatus(WOO_SAGA_TYPE, orderKey, "PENDING", {
          currentStep: "dry_run_logged",
        });
      }
      await markAudit(
        "processed",
        `ORDER_PIPELINE_MODE=${mode}: dry run, Katana SO/MTO skipped (${pipelineModeLabel(mode)}).`,
      );
    });
    return {
      ok: true as const,
      orderId: order.id,
      orderNo,
      pipelineMode: mode,
      ledgerMode: modes.ledgerMode,
      dryRun: true as const,
    };
  }

  // 3-4. LIVE: Katana SO then one MTO step per row. Errors here are terminal-failure handling.
  let salesOrder: SalesOrderResult | undefined;
  const moIds: number[] = [];
  let failedLeg: SagaFailedLeg = "sales_order";

  try {
    await step.run("saga-in-progress", () =>
      deps.store.setStatus(WOO_SAGA_TYPE, orderKey, "IN_PROGRESS"),
    );

    if (lineCount > WOO_MO_LISTING_LIMIT) {
      throw new NonRetriableError(
        `WooCommerce order ${order.id} has ${lineCount} lines (> ${WOO_MO_LISTING_LIMIT}); ` +
          "the MO duplicate check cannot page that far. Manual review required.",
      );
    }

    salesOrder = await runKatanaStep<SalesOrderResult>(step, "ensure-katana-sales-order", () =>
      wooKatanaCall(async () => {
        const result = await ensureSalesOrder(order, orderNo, deps.katana);
        if (result.rowIds.length !== lineCount) {
          throw new KatanaApiError(
            `${orderNo} has ${result.rowIds.length} sales order rows for ${lineCount} Woo line items.`,
            { status: 422 },
          );
        }
        return result;
      }),
    );
    const soResult = salesOrder;
    await step.run("saga-so-created", () =>
      deps.store.setStep(WOO_SAGA_TYPE, orderKey, "so_created"),
    );

    failedLeg = "manufacturing_orders";
    for (const rowId of soResult.rowIds) {
      const row = await runKatanaStep<MoRowResult>(step, `mto-row-${rowId}`, () =>
        wooKatanaCall(async () => {
          // NOT idempotent at Katana: check for an existing MO on this row BEFORE creating.
          const existingMoId = await deps.katana.findMoIdForRow(soResult.salesOrderId, rowId);
          if (existingMoId) return { rowId, moId: existingMoId, reused: true };
          return { rowId, moId: await deps.katana.createMoForRow(rowId), reused: false };
        }),
      );
      moIds.push(row.moId);
    }
    await step.run("saga-mo-created", () =>
      deps.store.setStep(WOO_SAGA_TYPE, orderKey, "mo_created"),
    );
  } catch (error) {
    await step.run("saga-mark-failed", async () => {
      // A paid saga: never a delete. Phase 10 builds no Katana delete executor at all.
      const plan = planCompensation({
        paid: true,
        failedLeg,
        createdSoId: salesOrder?.salesOrderId ?? null,
        createdMoIds: moIds,
      });
      assertNeverDeletePaid(true, plan);
      try {
        await deps.store.fail(WOO_SAGA_TYPE, orderKey, error, plan.status);
        await markAudit("failed", error instanceof Error ? error.message.slice(0, 500) : "failed");
      } catch (markError) {
        // The original error is rethrown below; losing the marker must not be silent.
        console.error(
          JSON.stringify({
            tag: "woo-saga-mark-failed-failed",
            orderId: order.id,
            failedLeg,
            error: markError instanceof Error ? markError.message : String(markError),
          }),
        );
      }
      return { status: plan.status, actions: plan.actions.length };
    });
    throw error;
  }

  // 5. Ledger leg (gated seam, no QBO). A ledger failure retries per planCompensation
  //    (`retry_ledger`) and never rolls the order back.
  const ledger = await step.run("ledger-leg", () =>
    runWooLedgerLeg({
      order: { id: order.id },
      orderNo,
      mode: modes.ledgerMode,
      store: deps.store,
    }),
  );

  await step.run("mark-audit-processed", () =>
    markAudit(
      "processed",
      `Katana SO ${salesOrder?.salesOrderId} + ${moIds.length} MO(s) ready; ledger ${ledger.marker}.`,
    ),
  );

  return {
    ok: true as const,
    orderId: order.id,
    orderNo,
    pipelineMode: mode,
    ledgerMode: modes.ledgerMode,
    dryRun: false as const,
    katanaSalesOrderId: salesOrder?.salesOrderId,
    manufacturingOrderIds: moIds,
    ledgerMarker: ledger.marker,
  };
}

export const processWooCommerceOrder = inngest.createFunction(
  {
    id: "process-woocommerce-order",
    name: "Process WooCommerce Order",
    triggers: [{ event: WOO_ORDER_EVENT }],
    // Layer 2 of 4 against duplicates (1: event id, 2: this, 3: saga_runs unique key,
    // 4: Katana order_no lookup).
    idempotency: IDEMPOTENCY_BY_EVENT_ID,
    // Per-order serialization AND the single-tenant Katana limit (Inngest allows 2 entries).
    concurrency: [{ limit: 1, key: "event.data.id" }, KATANA_TENANT_CONCURRENCY],
    retries: 3,
    // No onFailure alert: the global DLQ is the single alert authority (dlq-context.ts carries
    // the Woo-specific resolution link).
  },
  async ({ event, step }) =>
    runWooOrderSaga({ event, step: step as unknown as WooSagaStep }),
);
