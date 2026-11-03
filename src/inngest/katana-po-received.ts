/**
 * Phase 15 — Katana PO receipt delta recorder and supplier `QBO_ID` refresher
 * (§15.2a/b, §VI R-1/R-4/R-5/R-6/R-8/R-9, §VII S-2/S-4/S-5/S-6/S-7).
 *
 * Invariants:
 *  - Zero QBO, GHL, WooCommerce, or Clover imports (Katana-slot isolation, D-11).
 *  - Every Katana GET runs inside `runKatanaStep` (`assertKatanaDeferContext`).
 *  - `record-receipt` serializes per PO via `pg_advisory_xact_lock` on `getDb()` (never `getMutexDb()`).
 *  - Supplier issues (`vendor_ref_error`) never drop a receipt; they are persisted on the row.
 *  - Never logs `sup.comment` or defaults a vendor name.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { assertKatanaDeferContext, runKatanaStep } from "./katana-step";
import { KatanaApiError, katanaFetch } from "@/lib/katana";
import { parseKatanaListPayload } from "@/lib/katana-mto";
import { logStructured } from "@/lib/log/structured";
import { scrubSecretText } from "@/inngest/dlq";
import { getDb, type MiddlewareDb } from "@/server/db/client";
import {
  dlq_events,
  katana_po_bills,
  saga_runs,
  type KatanaPoBillAction,
  type KatanaPoBillLine,
  type KatanaPoBillParkReason,
  type KatanaPoBillRedriveEntry,
} from "@/server/db/schema";
import {
  KATANA_PO_BILL_POST_EVENT,
  KATANA_PO_BILL_SAGA_TYPE,
  KATANA_PO_BILL_VENDOR_REFRESH_EVENT,
  checkLedgerPostConfig,
  computeReceiptDelta,
  derivePoBillRequestId,
  deriveReceiptDateInZone,
  isValidIanaTimeZone,
  parseQboVendorIdFromSupplier,
  readPoReceiptRows,
  receiptFingerprint,
  snapshotDecreasesAgainstPrior,
  type PoPriceDriftEntry,
  type PoReceiptRow,
  type PriorBill,
  type VendorRefError,
} from "@/server/katana/po-receipt-ledger";
import { asRecord, positiveInt } from "@/server/katana/webhook-events";
import { getLedgerMode } from "@/server/pipeline/ledger-mode";
import { IDEMPOTENCY_BY_EVENT_ID } from "@/server/sre/idempotency";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";

export const KATANA_PO_RECEIVED_EVENT = "katana/purchase_order.received" as const;
export { KATANA_PO_BILL_POST_EVENT, KATANA_PO_BILL_VENDOR_REFRESH_EVENT };

export type HydratedKatanaSupplier = {
  supplierId: number | null;
  supplierName: string | null;
  qboVendorId: string | null;
  vendorRefError: VendorRefError | null;
};

export type HydratedKatanaPo = HydratedKatanaSupplier & {
  katanaPoId: number;
  orderNo: string;
  currency: string;
  poCreatedAtIso: string | null;
  rows: PoReceiptRow[];
  fingerprint: string;
};

async function resolveSupplierFromKatana(
  supplierId: number | null,
): Promise<HydratedKatanaSupplier> {
  if (!supplierId || supplierId <= 0) {
    return {
      supplierId: null,
      supplierName: null,
      qboVendorId: null,
      vendorRefError: "supplier_missing",
    };
  }

  let supplierObj: Record<string, unknown> | null = null;
  try {
    const { data } = await katanaFetch<unknown>(`/suppliers/${supplierId}`);
    const root = asRecord(data);
    supplierObj = asRecord(root?.data) ?? root;
  } catch (error) {
    if (
      error instanceof KatanaApiError &&
      (error.status === 404 || error.status === 405)
    ) {
      const { data: listData } = await katanaFetch<unknown>(
        `/suppliers?ids=${encodeURIComponent(String(supplierId))}`,
      );
      const list = parseKatanaListPayload(listData).filter(
        (item) => positiveInt(item.id) === supplierId,
      );
      if (list.length === 1) {
        supplierObj = list[0]!;
      } else {
        return {
          supplierId,
          supplierName: null,
          qboVendorId: null,
          vendorRefError: "supplier_not_found",
        };
      }
    } else {
      throw error;
    }
  }

  if (!supplierObj || positiveInt(supplierObj.id) !== supplierId) {
    return {
      supplierId,
      supplierName: null,
      qboVendorId: null,
      vendorRefError: "supplier_not_found",
    };
  }

  const supplierName =
    typeof supplierObj.name === "string" && supplierObj.name.trim()
      ? supplierObj.name.trim()
      : null;

  const parsed = parseQboVendorIdFromSupplier(supplierObj);
  if (!parsed.ok) {
    logStructured("warn", "katana-supplier-qbo-id-invalid", {
      supplierId,
      reason: parsed.reason,
    });
    return {
      supplierId,
      supplierName,
      qboVendorId: null,
      vendorRefError: parsed.reason,
    };
  }

  return {
    supplierId,
    supplierName,
    qboVendorId: parsed.qboVendorId,
    vendorRefError: null,
  };
}

export async function fetchKatanaPoWithSupplier(
  purchaseOrderId: number,
  fallbackOrderNo?: string | null,
): Promise<HydratedKatanaPo> {
  assertKatanaDeferContext("fetchKatanaPoWithSupplier");
  const { data: poRaw } = await katanaFetch<unknown>(
    `/purchase_orders/${purchaseOrderId}`,
  );
  const root = asRecord(poRaw);
  const po = asRecord(root?.data) ?? root;
  if (!po) {
    throw new Error(`Katana PO ${purchaseOrderId} returned an empty payload`);
  }

  const orderNo =
    (typeof po.order_no === "string" && po.order_no.trim()) ||
    (fallbackOrderNo?.trim() ?? "") ||
    `PO-${purchaseOrderId}`;
  const currency =
    typeof po.currency === "string" && po.currency.trim()
      ? po.currency.trim().toUpperCase()
      : "USD";
  const poCreatedAtIso =
    typeof po.created_at === "string" && po.created_at.trim()
      ? po.created_at.trim()
      : null;

  const supplierId = positiveInt(po.supplier_id);
  const supplier = await resolveSupplierFromKatana(supplierId);
  const rows = readPoReceiptRows(po);
  const fingerprint = receiptFingerprint(purchaseOrderId, rows);

  return {
    katanaPoId: purchaseOrderId,
    orderNo,
    currency,
    poCreatedAtIso,
    rows,
    fingerprint,
    ...supplier,
  };
}

export async function fetchKatanaPoSupplierOnly(
  purchaseOrderId: number,
): Promise<HydratedKatanaSupplier> {
  assertKatanaDeferContext("fetchKatanaPoSupplierOnly");
  const { data: poRaw } = await katanaFetch<unknown>(
    `/purchase_orders/${purchaseOrderId}`,
  );
  const root = asRecord(poRaw);
  const po = asRecord(root?.data) ?? root;
  if (!po) {
    throw new Error(`Katana PO ${purchaseOrderId} returned an empty payload`);
  }
  // §VII S-4.2: PO rows are deliberately ignored so frozen bill lines & fingerprint never change.
  const supplierId = positiveInt(po.supplier_id);
  return resolveSupplierFromKatana(supplierId);
}

type PoBillRow = typeof katana_po_bills.$inferSelect;

type RecordReceiptOutcome =
  | { outcome: "duplicate"; row: PoBillRow }
  | { outcome: "needs_refetch" }
  | {
      outcome: "recorded";
      row: PoBillRow;
      priceDrift: PoPriceDriftEntry[];
      throwMessage?: string;
    };

async function upsertPoSagaInTx(
  tx: Parameters<Parameters<MiddlewareDb["transaction"]>[0]>[0],
  correlationKey: string,
  status: "IN_PROGRESS" | "COMPLETED" | "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
  currentStep: string,
  lastError: string | null = null,
) {
  const scrubbed = lastError ? scrubSecretText(lastError).slice(0, 2000) : null;
  await tx
    .insert(saga_runs)
    .values({
      saga_type: KATANA_PO_BILL_SAGA_TYPE,
      correlation_key: correlationKey,
      status,
      current_step: currentStep,
      last_error: scrubbed,
    })
    .onConflictDoUpdate({
      target: [saga_runs.saga_type, saga_runs.correlation_key],
      set: {
        status,
        current_step: currentStep,
        last_error: scrubbed,
        updated_at: new Date(),
      },
    });
}

async function recordReceiptInTransaction(
  db: MiddlewareDb,
  po: HydratedKatanaPo,
  options: {
    action: KatanaPoBillAction;
    allowDecrease: boolean;
    ledgerMode: "log" | "live";
    timeZone: string;
    runId: string;
  },
): Promise<RecordReceiptOutcome> {
  return db.transaction(async (tx) => {
    // §VI R-4.2: transaction-scoped advisory lock on regular `getDb()` pool.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('katana_po_bills:' || ${String(po.katanaPoId)}, 0))`,
    );

    const existingRows = await tx
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, po.katanaPoId))
      .orderBy(asc(katana_po_bills.receipt_seq));

    const duplicate = existingRows.find(
      (r) => r.receipt_fingerprint === po.fingerprint,
    );
    if (duplicate) {
      return { outcome: "duplicate", row: duplicate };
    }

    const prior: PriorBill[] = existingRows.map((r) => ({
      lines: r.lines,
      status: r.status,
    }));

    if (!options.allowDecrease && snapshotDecreasesAgainstPrior(po.rows, prior)) {
      return { outcome: "needs_refetch" };
    }

    const receiptSeq =
      existingRows.length > 0
        ? existingRows[existingRows.length - 1]!.receipt_seq + 1
        : 1;
    const requestId = derivePoBillRequestId(po.katanaPoId, po.fingerprint, 0);
    const correlationKey = `${po.katanaPoId}:${receiptSeq}`;

    const hasOpenNegative = existingRows.some(
      (r) =>
        r.status === "requires_manual_intervention" &&
        r.park_reason === "negative_receipt",
    );

    const computed = computeReceiptDelta(po.rows, prior);

    const effectiveZone = isValidIanaTimeZone(options.timeZone)
      ? options.timeZone.trim()
      : "UTC";

    if (computed.kind === "negative") {
      const deltaIds = new Set(computed.rowIds);
      const receiptDate = deriveReceiptDateInZone(
        po.rows,
        deltaIds,
        effectiveZone,
        po.poCreatedAtIso,
      );
      const message = `PO ${po.orderNo} receipt decreased on rows [${computed.rowIds.join(", ")}] (credit ${computed.expectedCreditCents} cents). Issue VendorCredit or confirm Katana correction via: npm run ops:po-bills -- resolve --id <billRowId>`;

      const [inserted] = await tx
        .insert(katana_po_bills)
        .values({
          katana_po_id: po.katanaPoId,
          order_no: po.orderNo,
          receipt_fingerprint: po.fingerprint,
          receipt_seq: receiptSeq,
          action: options.action,
          lines: computed.lines,
          delta_total_cents: 0,
          qbo_request_id: requestId,
          status: "requires_manual_intervention",
          park_reason: "negative_receipt",
          parked_run_id: options.runId,
          last_error: scrubSecretText(message).slice(0, 2000),
          receipt_date: receiptDate,
          katana_supplier_id: po.supplierId,
          qbo_vendor_id: po.qboVendorId,
          vendor_ref_error: po.vendorRefError,
        })
        .returning();

      await upsertPoSagaInTx(
        tx,
        correlationKey,
        "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        "parked_negative_receipt",
        message,
      );

      return {
        outcome: "recorded",
        row: inserted!,
        priceDrift: [],
        throwMessage: message,
      };
    }

    const lines: KatanaPoBillLine[] =
      computed.kind === "delta" ? computed.lines : [];
    const deltaTotalCents =
      computed.kind === "delta" ? computed.deltaTotalCents : 0;
    const priceDrift = computed.priceDrift;

    const deltaIds = new Set(lines.map((l) => l.rowId));
    const receiptDate = isValidIanaTimeZone(options.timeZone)
      ? deriveReceiptDateInZone(
          po.rows,
          deltaIds,
          options.timeZone.trim(),
          po.poCreatedAtIso,
        )
      : deriveReceiptDateInZone(po.rows, deltaIds, "UTC", po.poCreatedAtIso);

    // §VII S-6.3: Frozen PO lane while an open negative_receipt exists.
    if (hasOpenNegative) {
      const message = `PO ${po.orderNo} is frozen by an unresolved negative_receipt row. Resolve the negative receipt first, then run: npm run ops:po-bills -- retry --po ${po.katanaPoId}`;
      const [inserted] = await tx
        .insert(katana_po_bills)
        .values({
          katana_po_id: po.katanaPoId,
          order_no: po.orderNo,
          receipt_fingerprint: po.fingerprint,
          receipt_seq: receiptSeq,
          action: options.action,
          lines,
          delta_total_cents: deltaTotalCents,
          qbo_request_id: requestId,
          status: "requires_manual_intervention",
          park_reason: "po_frozen",
          parked_run_id: options.runId,
          last_error: scrubSecretText(message).slice(0, 2000),
          receipt_date: receiptDate,
          katana_supplier_id: po.supplierId,
          qbo_vendor_id: po.qboVendorId,
          vendor_ref_error: po.vendorRefError,
          price_drift: priceDrift.length > 0 ? priceDrift : null,
        })
        .returning();

      await upsertPoSagaInTx(
        tx,
        correlationKey,
        "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        "parked_po_frozen",
        message,
      );

      return {
        outcome: "recorded",
        row: inserted!,
        priceDrift,
        ...(options.ledgerMode === "live" ? { throwMessage: message } : {}),
      };
    }

    // §VI R-8.3: Non-USD currency parks in live mode.
    if (po.currency !== "USD" && options.ledgerMode === "live") {
      const message = `PO ${po.orderNo} currency "${po.currency}" is unsupported (multi-currency A/P requires manual entry). Enter by hand, then run: npm run ops:po-bills -- resolve --id <billRowId> --kind entered_by_hand`;
      const [inserted] = await tx
        .insert(katana_po_bills)
        .values({
          katana_po_id: po.katanaPoId,
          order_no: po.orderNo,
          receipt_fingerprint: po.fingerprint,
          receipt_seq: receiptSeq,
          action: options.action,
          lines,
          delta_total_cents: deltaTotalCents,
          qbo_request_id: requestId,
          status: "requires_manual_intervention",
          park_reason: "currency_unsupported",
          parked_run_id: options.runId,
          last_error: scrubSecretText(message).slice(0, 2000),
          receipt_date: receiptDate,
          katana_supplier_id: po.supplierId,
          qbo_vendor_id: po.qboVendorId,
          vendor_ref_error: po.vendorRefError,
          price_drift: priceDrift.length > 0 ? priceDrift : null,
        })
        .returning();

      await upsertPoSagaInTx(
        tx,
        correlationKey,
        "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        "parked_currency_unsupported",
        message,
      );

      return {
        outcome: "recorded",
        row: inserted!,
        priceDrift,
        throwMessage: message,
      };
    }

    // §VII S-5.4: Price drift parks in live mode; logs & dry-runs in log mode.
    if (priceDrift.length > 0 && options.ledgerMode === "live") {
      const trueUpTotal = priceDrift.reduce((s, d) => s + d.trueUpCents, 0);
      const driftedRows = priceDrift.map((d) => d.rowId).join(", ");
      const [inserted] = await tx
        .insert(katana_po_bills)
        .values({
          katana_po_id: po.katanaPoId,
          order_no: po.orderNo,
          receipt_fingerprint: po.fingerprint,
          receipt_seq: receiptSeq,
          action: options.action,
          lines,
          delta_total_cents: deltaTotalCents,
          qbo_request_id: requestId,
          status: "requires_manual_intervention",
          park_reason: "price_drift",
          parked_run_id: options.runId,
          last_error: `PO ${po.orderNo} price changed on rows [${driftedRows}] after billing; earlier bills differ by ${trueUpTotal} cents.`,
          receipt_date: receiptDate,
          katana_supplier_id: po.supplierId,
          qbo_vendor_id: po.qboVendorId,
          vendor_ref_error: po.vendorRefError,
          price_drift: priceDrift,
        })
        .returning();

      const fullMessage = `PO ${po.orderNo} price changed on rows [${driftedRows}] after billing; earlier bills differ by ${trueUpTotal} cents. Fix the earlier bill in QBO, then: npm run ops:po-bills -- retry --id ${inserted!.id} --approve-price-drift`;

      await tx
        .update(katana_po_bills)
        .set({ last_error: scrubSecretText(fullMessage).slice(0, 2000) })
        .where(eq(katana_po_bills.id, inserted!.id));

      await upsertPoSagaInTx(
        tx,
        correlationKey,
        "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        "parked_price_drift",
        fullMessage,
      );

      return {
        outcome: "recorded",
        row: { ...inserted!, last_error: fullMessage },
        priceDrift,
        throwMessage: fullMessage,
      };
    }

    if (computed.kind === "no_delta") {
      const [inserted] = await tx
        .insert(katana_po_bills)
        .values({
          katana_po_id: po.katanaPoId,
          order_no: po.orderNo,
          receipt_fingerprint: po.fingerprint,
          receipt_seq: receiptSeq,
          action: options.action,
          lines: [],
          delta_total_cents: 0,
          qbo_request_id: requestId,
          status: "no_delta",
          receipt_date: receiptDate,
          katana_supplier_id: po.supplierId,
          qbo_vendor_id: po.qboVendorId,
          vendor_ref_error: po.vendorRefError,
          price_drift: priceDrift.length > 0 ? priceDrift : null,
        })
        .returning();

      await upsertPoSagaInTx(tx, correlationKey, "COMPLETED", "no_delta");
      return { outcome: "recorded", row: inserted!, priceDrift };
    }

    const [inserted] = await tx
      .insert(katana_po_bills)
      .values({
        katana_po_id: po.katanaPoId,
        order_no: po.orderNo,
        receipt_fingerprint: po.fingerprint,
        receipt_seq: receiptSeq,
        action: options.action,
        lines,
        delta_total_cents: deltaTotalCents,
        qbo_request_id: requestId,
        status: "pending",
        receipt_date: receiptDate,
        katana_supplier_id: po.supplierId,
        qbo_vendor_id: po.qboVendorId,
        vendor_ref_error: po.vendorRefError,
        price_drift: priceDrift.length > 0 ? priceDrift : null,
      })
      .returning();

    await upsertPoSagaInTx(tx, correlationKey, "IN_PROGRESS", "recorded");
    return { outcome: "recorded", row: inserted!, priceDrift };
  });
}

export type PoReceivedStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

export type SyncKatanaPoReceivedDeps = {
  getDb?: () => MiddlewareDb;
  fetchPo?: (poId: number, fallbackOrderNo?: string | null) => Promise<HydratedKatanaPo>;
  env?: Record<string, string | undefined>;
};

export async function runSyncKatanaPoReceived(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PoReceivedStepLike;
    runId?: string;
  },
  deps: SyncKatanaPoReceivedDeps = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const fetchPo = deps.fetchPo ?? fetchKatanaPoWithSupplier;
  const env = deps.env ?? process.env;
  const runId = input.runId ?? "run_po_received";

  const purchaseOrderId = positiveInt(input.event.data?.purchaseOrderId);
  if (!purchaseOrderId) {
    throw new NonRetriableError(
      `${KATANA_PO_RECEIVED_EVENT} requires a positive purchaseOrderId`,
    );
  }
  const rawAction = String(input.event.data?.action ?? "purchase_order.received");
  const action: KatanaPoBillAction =
    rawAction === "purchase_order.partially_received"
      ? "purchase_order.partially_received"
      : "purchase_order.received";
  const fallbackOrderNo =
    typeof input.event.data?.orderNo === "string" ? input.event.data.orderNo : null;

  const initialPo = await runKatanaStep<HydratedKatanaPo>(
    input.step,
    "fetch-katana-po-details",
    () => fetchPo(purchaseOrderId, fallbackOrderNo),
  );

  const ledgerMode = getLedgerMode("qbo", env);
  const timeZone = env.LEDGER_COMPANY_TIMEZONE?.trim() ?? "";

  let recorded = await input.step.run("record-receipt", () =>
    recordReceiptInTransaction(resolveDb(), initialPo, {
      action,
      allowDecrease: false,
      ledgerMode,
      timeZone,
      runId,
    }),
  );

  // §VII S-6.1: Refetch once when snapshot cumulative is lower than latest recorded state.
  let activePo = initialPo;
  if (recorded.outcome === "needs_refetch") {
    activePo = await runKatanaStep<HydratedKatanaPo>(
      input.step,
      "refetch-katana-po",
      () => fetchPo(purchaseOrderId, fallbackOrderNo),
    );
    recorded = await input.step.run("record-receipt-after-refetch", () =>
      recordReceiptInTransaction(resolveDb(), activePo, {
        action,
        allowDecrease: true,
        ledgerMode,
        timeZone,
        runId,
      }),
    );
  }

  if (recorded.outcome === "duplicate") {
    return {
      ok: true as const,
      duplicate: true as const,
      billRowId: recorded.row.id,
      status: recorded.row.status,
    };
  }

  if (recorded.outcome !== "recorded") {
    return { ok: true as const, skipped: "unexpected_state" as const };
  }

  if (recorded.priceDrift.length > 0) {
    logStructured("warn", "katana-po-price-drift", {
      katanaPoId: purchaseOrderId,
      orderNo: activePo.orderNo,
      drift: recorded.priceDrift,
    });
  }

  if (recorded.throwMessage) {
    throw new NonRetriableError(recorded.throwMessage);
  }

  const row = recorded.row;
  if (row.status === "no_delta" || row.status === "posted" || row.status === "dry_run") {
    return {
      ok: true as const,
      skipped: row.status,
      billRowId: row.id,
      receiptSeq: row.receipt_seq,
    };
  }

  if (row.status === "requires_manual_intervention") {
    return {
      ok: true as const,
      parked: true as const,
      parkReason: row.park_reason,
      billRowId: row.id,
      receiptSeq: row.receipt_seq,
    };
  }

  if (ledgerMode !== "live") {
    await input.step.run("mark-dry-run", async () => {
      const db = resolveDb();
      await db.transaction(async (tx) => {
        await tx
          .update(katana_po_bills)
          .set({ status: "dry_run", updated_at: new Date() })
          .where(eq(katana_po_bills.id, row.id));
        await upsertPoSagaInTx(
          tx,
          `${purchaseOrderId}:${row.receipt_seq}`,
          "COMPLETED",
          "dry_run",
        );
      });
    });

    const configCheck = checkLedgerPostConfig(env);
    return {
      ok: true as const,
      mode: "log" as const,
      action,
      purchaseOrderId,
      billRowId: row.id,
      orderNo: row.order_no,
      receiptSeq: row.receipt_seq,
      deltaTotalCents: row.delta_total_cents,
      lineCount: row.lines.length,
      qboConfigReady: configCheck.ok,
      qboVendorIdReady: Boolean(row.qbo_vendor_id && !row.vendor_ref_error),
      vendorRefError: row.vendor_ref_error,
      message:
        "QBO_LEDGER_MODE=log — Dry run recorded; set QBO_LEDGER_MODE=live to POST QBO Bill.",
    };
  }

  await input.step.sendEvent("request-qbo-bill", {
    id: `katana-po-bill:${row.id}:r0`,
    name: KATANA_PO_BILL_POST_EVENT,
    data: {
      billRowId: row.id,
      katanaPoId: purchaseOrderId,
      redriveSeq: 0,
      supplierName: activePo.supplierName,
    },
  });

  return {
    ok: true as const,
    mode: "live" as const,
    queued: true as const,
    action,
    purchaseOrderId,
    billRowId: row.id,
    receiptSeq: row.receipt_seq,
    deltaTotalCents: row.delta_total_cents,
  };
}

export const syncKatanaPoReceived = inngest.createFunction(
  {
    id: "sync-katana-po-received",
    name: "Katana PO Received -> QBO A/P Vendor Bill",
    triggers: [{ event: KATANA_PO_RECEIVED_EVENT }],
    idempotency: IDEMPOTENCY_BY_EVENT_ID,
    concurrency: [
      { limit: 1, key: "event.data.purchaseOrderId" },
      KATANA_TENANT_CONCURRENCY,
    ],
  },
  async ({ event, step, runId }) =>
    runSyncKatanaPoReceived({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PoReceivedStepLike,
      runId,
    }),
);

export async function runRefreshKatanaPoBillVendor(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PoReceivedStepLike;
  },
  deps: {
    getDb?: () => MiddlewareDb;
    fetchSupplierOnly?: (poId: number) => Promise<HydratedKatanaSupplier>;
  } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const fetchSup = deps.fetchSupplierOnly ?? fetchKatanaPoSupplierOnly;

  const billRowId = String(input.event.data?.billRowId ?? "").trim();
  const katanaPoId = positiveInt(input.event.data?.katanaPoId);
  const expectedRedriveCount = Number(input.event.data?.expectedRedriveCount ?? -1);
  const operator = String(input.event.data?.operator ?? "ops").trim() || "ops";

  if (!billRowId || !katanaPoId || !Number.isInteger(expectedRedriveCount) || expectedRedriveCount < 0) {
    throw new NonRetriableError(
      `${KATANA_PO_BILL_VENDOR_REFRESH_EVENT} missing billRowId, katanaPoId, or expectedRedriveCount`,
    );
  }

  const supplier = await runKatanaStep<HydratedKatanaSupplier>(
    input.step,
    "refetch-katana-supplier",
    () => fetchSup(katanaPoId),
  );

  const transition = await input.step.run("apply-vendor-refresh", async () => {
    const db = resolveDb();
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(katana_po_bills)
        .where(eq(katana_po_bills.id, billRowId))
        .limit(1);

      if (!current || current.status !== "requires_manual_intervention") {
        return { outcome: "skipped" as const, reason: "not_parked" as const };
      }
      if (current.redrive_count !== expectedRedriveCount) {
        return { outcome: "skipped" as const, reason: "stale_redrive" as const };
      }

      if (supplier.vendorRefError || !supplier.qboVendorId) {
        const blockReason = (supplier.vendorRefError ?? "vendor_qbo_id_missing") as KatanaPoBillParkReason;
        const entry: KatanaPoBillRedriveEntry = {
          seq: expectedRedriveCount + 1,
          at: new Date().toISOString(),
          operator,
          action: "retry",
          parkReason: current.park_reason,
          previousRequestId: current.qbo_request_id,
          previousError: current.last_error,
          outcome: `still_blocked:${blockReason}`,
        };
        const nextLog = [...(current.redrive_log ?? []), entry];
        const updated = await tx
          .update(katana_po_bills)
          .set({
            katana_supplier_id: supplier.supplierId,
            vendor_ref_error: blockReason,
            park_reason: blockReason,
            redrive_log: nextLog,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(katana_po_bills.id, billRowId),
              eq(katana_po_bills.status, "requires_manual_intervention"),
              eq(katana_po_bills.redrive_count, expectedRedriveCount),
            ),
          )
          .returning({ id: katana_po_bills.id });

        if (!updated[0]) {
          return { outcome: "skipped" as const, reason: "stale_redrive" as const };
        }
        return {
          outcome: "still_blocked" as const,
          reason: blockReason,
        };
      }

      const nextCount = expectedRedriveCount + 1;
      const nextRequestId = derivePoBillRequestId(
        current.katana_po_id,
        current.receipt_fingerprint,
        nextCount,
      );
      const entry: KatanaPoBillRedriveEntry = {
        seq: nextCount,
        at: new Date().toISOString(),
        operator,
        action: "retry",
        parkReason: current.park_reason,
        previousRequestId: current.qbo_request_id,
        previousError: current.last_error,
        outcome: "reopened_after_vendor_refresh",
      };
      const nextLog = [...(current.redrive_log ?? []), entry];

      const updated = await tx
        .update(katana_po_bills)
        .set({
          katana_supplier_id: supplier.supplierId,
          qbo_vendor_id: supplier.qboVendorId,
          vendor_ref_error: null,
          status: "pending",
          redrive_count: nextCount,
          qbo_request_id: nextRequestId,
          last_error: null,
          redrive_log: nextLog,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(katana_po_bills.id, billRowId),
            eq(katana_po_bills.status, "requires_manual_intervention"),
            eq(katana_po_bills.redrive_count, expectedRedriveCount),
          ),
        )
        .returning({ id: katana_po_bills.id, receipt_seq: katana_po_bills.receipt_seq });

      if (!updated[0]) {
        return { outcome: "skipped" as const, reason: "stale_redrive" as const };
      }

      await upsertPoSagaInTx(
        tx,
        `${current.katana_po_id}:${current.receipt_seq}`,
        "IN_PROGRESS",
        `redriven_r${nextCount}`,
        null,
      );

      if (current.parked_run_id) {
        await tx
          .update(dlq_events)
          .set({
            status: "resolved",
            updated_at: new Date(),
          })
          .where(
            and(
              eq(dlq_events.run_id, current.parked_run_id),
              eq(dlq_events.status, "open"),
            ),
          );
      }

      return {
        outcome: "reopened" as const,
        redriveSeq: nextCount,
      };
    });
  });

  if (transition.outcome !== "reopened") {
    return {
      ok: true as const,
      ...transition,
    };
  }

  await input.step.sendEvent("request-qbo-bill", {
    id: `katana-po-bill:${billRowId}:r${transition.redriveSeq}`,
    name: KATANA_PO_BILL_POST_EVENT,
    data: {
      billRowId,
      katanaPoId,
      redriveSeq: transition.redriveSeq,
      supplierName: supplier.supplierName,
    },
  });

  return {
    ok: true as const,
    reopened: true as const,
    redriveSeq: transition.redriveSeq,
  };
}

export const refreshKatanaPoBillVendor = inngest.createFunction(
  {
    id: "refresh-katana-po-bill-vendor",
    name: "Refresh Katana PO Supplier QBO_ID -> Reopen Bill",
    triggers: [{ event: KATANA_PO_BILL_VENDOR_REFRESH_EVENT }],
    concurrency: [
      { limit: 1, key: "event.data.katanaPoId" },
      KATANA_TENANT_CONCURRENCY,
    ],
    retries: 3,
  },
  async ({ event, step }) =>
    runRefreshKatanaPoBillVendor({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PoReceivedStepLike,
    }),
);
