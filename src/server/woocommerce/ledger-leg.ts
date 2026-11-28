/**
 * Phase 10 Task 8 — Woo ledger leg: a GATED SEAM, no QBO in this phase.
 *
 * Step 8 owns the QuickBooks financial routing. This module only creates the gate and the
 * hand-off marker. It must NEVER import or call anything under `src/server/integrations/qbo/`
 * (enforced by tests/woo-static-guards.test.ts), and it carries no financial payload.
 *
 * Mode is `WOO_LEDGER_MODE` (via getLedgerMode("woo")); never falls back to LEDGER_PIPELINE_MODE.
 *  - mode !== "live" (log, unset, garbage): structured `ledger-containment` log line and the
 *    saga step `ledger_dry_run`.
 *  - mode === "live": STILL no QBO call. The saga step becomes `awaiting_ledger_step_8` with
 *    status IN_PROGRESS and a loud `ledger-not-implemented` error line. Step 8 resumes from
 *    that marker (the saga ledger is a status ledger with no poller, so step 8 queries for it).
 *    The saga is NEVER marked COMPLETED while the ledger leg is unbuilt.
 */
import { getLedgerMode, type LedgerPipelineMode } from "@/server/pipeline/ledger-mode";
import { sagaStore, type SagaStore } from "@/server/sre/saga-store";
import { WOO_SAGA_TYPE } from "@/server/woocommerce/ingress";
import {
  buildQboTaxPassthroughPayload,
  extractTaxJarTelemetry,
  type TaxJarOrderTelemetry,
} from "@/server/woocommerce/taxjar-passthrough";

export const WOO_LEDGER_DRY_RUN_STEP = "ledger_dry_run";
export const WOO_LEDGER_AWAITING_STEP = "awaiting_ledger_step_8";

export type WooLedgerLegResult = {
  mode: LedgerPipelineMode;
  dryRun: boolean;
  /** The saga `current_step` that was written. */
  marker: typeof WOO_LEDGER_DRY_RUN_STEP | typeof WOO_LEDGER_AWAITING_STEP;
  /** Staged QBO tax pass-through (log mode proves TaxJar totals; never recalculated). */
  qboTaxPassthrough?: ReturnType<typeof buildQboTaxPassthroughPayload>;
};

export async function runWooLedgerLeg(input: {
  order: { id: number | string } & Partial<Parameters<typeof extractTaxJarTelemetry>[0]>;
  orderNo: string;
  mode?: LedgerPipelineMode;
  store?: Pick<SagaStore, "setStatus">;
  taxjarTelemetry?: TaxJarOrderTelemetry;
}): Promise<WooLedgerLegResult> {
  // Woo lane reads WOO_LEDGER_MODE only (fail-closed to log; no LEDGER_PIPELINE_MODE fallback).
  const mode = input.mode ?? getLedgerMode("woo");
  const store = input.store ?? sagaStore;
  const orderId = String(input.order.id);

  const telemetry =
    input.taxjarTelemetry ?? extractTaxJarTelemetry(input.order);
  const qboTaxPassthrough = buildQboTaxPassthroughPayload(telemetry);

  // Fail closed: anything that is not exactly "live" is a dry run.
  if (mode !== "live") {
    console.log(
      JSON.stringify({
        tag: "ledger-containment",
        fn: "woo-order-saga",
        mode,
        dryRun: true,
        orderId,
        orderNo: input.orderNo,
        taxjar: {
          cart_tax: telemetry.cart_tax,
          shipping_tax: telemetry.shipping_tax,
          total_tax: telemetry.total_tax,
          shipping_total: telemetry.shipping_total,
          balanceOk: qboTaxPassthrough.CcPatioTaxTelemetry.balance.ok,
        },
        qboGlobalTaxCalculation: qboTaxPassthrough.GlobalTaxCalculation,
        qboTotalTax: qboTaxPassthrough.TxnTaxDetail.TotalTax,
      }),
    );
    await store.setStatus(WOO_SAGA_TYPE, orderId, "IN_PROGRESS", {
      currentStep: WOO_LEDGER_DRY_RUN_STEP,
    });
    return { mode, dryRun: true, marker: WOO_LEDGER_DRY_RUN_STEP, qboTaxPassthrough };
  }

  console.error(
    JSON.stringify({
      tag: "ledger-not-implemented",
      fn: "woo-order-saga",
      mode,
      orderId,
      orderNo: input.orderNo,
      message:
        "WOO_LEDGER_MODE=live but the QBO ledger leg (roadmap step 8) is not built. " +
        "No QBO call was made; saga parked at awaiting_ledger_step_8.",
    }),
  );
  await store.setStatus(WOO_SAGA_TYPE, orderId, "IN_PROGRESS", {
    currentStep: WOO_LEDGER_AWAITING_STEP,
  });
  return { mode, dryRun: false, marker: WOO_LEDGER_AWAITING_STEP };
}
