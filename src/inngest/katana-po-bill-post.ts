/**
 * Phase 15 — QuickBooks A/P Vendor Bill poster, operator redrive state machine,
 * and manual resolution verifier (§VI R-1/R-6/R-7/R-8, §VII S-2/S-3/S-4/S-5/S-6).
 *
 * Invariants:
 *  - Zero Katana imports and no `KATANA_TENANT_CONCURRENCY` (Katana-slot isolation, D-11).
 *  - `post-katana-po-bill` has NO function-level `idempotency` (§VII S-3).
 *  - No QBO HTTP call runs inside a Postgres `.transaction(...)` callback (§VI R-5.2).
 *  - Every state transition on parked rows is compare-and-set on `(status, redrive_count)`.
 */

import { and, eq } from "drizzle-orm";
import { NonRetriableError, RetryAfterError } from "inngest";
import { inngest } from "./client";
import { scrubSecretText } from "@/inngest/dlq";
import { logStructured } from "@/lib/log/structured";
import { getDb, type MiddlewareDb } from "@/server/db/client";
import {
  dlq_events,
  katana_po_bills,
  saga_runs,
  type KatanaPoBillLine,
  type KatanaPoBillParkReason,
  type KatanaPoBillRedriveEntry,
  type KatanaPoBillResolutionKind,
} from "@/server/db/schema";
import {
  QboConfigError,
  createQboVendorBillFromKatanaPo,
  fetchQboBillById,
  fetchQboVendorById,
  fetchQboVendorCreditById,
  findQboBillsByDocNumber,
  type CreateQboVendorBillInput,
  type QboBillSummary,
  type QboVendorCreditSummary,
  type QboVendorRecord,
} from "@/server/integrations/qbo/client";
import {
  QboApiError,
  QboAuthError,
} from "@/server/integrations/qbo/token-refresh";
import {
  KATANA_PO_BILL_POST_EVENT,
  KATANA_PO_BILL_REDRIVE_EVENT,
  KATANA_PO_BILL_RESOLVE_EVENT,
  KATANA_PO_BILL_SAGA_TYPE,
  KATANA_PO_BILL_VENDOR_REFRESH_EVENT,
  checkLedgerPostConfig,
  derivePoBillRequestId,
  evaluateResolveEligibility,
  evaluateRetryEligibility,
  formatEpochMsInZone,
  formatPoBillDocNumber,
  fromQtyE4,
  roundHalfUpFromE4,
} from "@/server/katana/po-receipt-ledger";
import { sagaStore } from "@/server/sre/saga-store";

export {
  KATANA_PO_BILL_POST_EVENT,
  KATANA_PO_BILL_REDRIVE_EVENT,
  KATANA_PO_BILL_RESOLVE_EVENT,
};

export type QboPostDeps = {
  fetchVendorById: (vendorId: string) => Promise<QboVendorRecord | null>;
  findBillsByDocNumber: (docNumber: string) => Promise<QboBillSummary[]>;
  createVendorBill: (
    input: CreateQboVendorBillInput,
  ) => Promise<{ billId: string; vendorId: string; totalDollars: string }>;
  fetchBillById: (billId: string) => Promise<QboBillSummary | null>;
  fetchVendorCreditById: (creditId: string) => Promise<QboVendorCreditSummary | null>;
};

const defaultQboDeps: QboPostDeps = {
  fetchVendorById: fetchQboVendorById,
  findBillsByDocNumber: findQboBillsByDocNumber,
  createVendorBill: createQboVendorBillFromKatanaPo,
  fetchBillById: fetchQboBillById,
  fetchVendorCreditById: fetchQboVendorCreditById,
};

export type PoBillPostStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

async function parkBillRow(
  db: MiddlewareDb,
  row: { id: string; katana_po_id: number; receipt_seq: number },
  parkReason: KatanaPoBillParkReason,
  runId: string,
  message: string,
) {
  const scrubbed = scrubSecretText(message).slice(0, 2000);
  await db
    .update(katana_po_bills)
    .set({
      status: "requires_manual_intervention",
      park_reason: parkReason,
      parked_run_id: runId,
      last_error: scrubbed,
      updated_at: new Date(),
    })
    .where(eq(katana_po_bills.id, row.id));

  await createSagaFailOnDb(
    db,
    `${row.katana_po_id}:${row.receipt_seq}`,
    scrubbed,
  );
}

async function createSagaFailOnDb(
  db: MiddlewareDb,
  correlationKey: string,
  scrubbedMessage: string,
) {
  await db
    .insert(saga_runs)
    .values({
      saga_type: KATANA_PO_BILL_SAGA_TYPE,
      correlation_key: correlationKey,
      status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
      current_step: "parked_manual_intervention",
      last_error: scrubbedMessage,
    })
    .onConflictDoUpdate({
      target: [saga_runs.saga_type, saga_runs.correlation_key],
      set: {
        status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        current_step: "parked_manual_intervention",
        last_error: scrubbedMessage,
        updated_at: new Date(),
      },
    });
  // Keep default sagaStore referenced for compatibility when using default DB.
  void sagaStore;
}

async function markSagaCompletedOnDb(
  db: MiddlewareDb,
  correlationKey: string,
  stepName: string,
) {
  await db
    .insert(saga_runs)
    .values({
      saga_type: KATANA_PO_BILL_SAGA_TYPE,
      correlation_key: correlationKey,
      status: "COMPLETED",
      current_step: stepName,
      last_error: null,
    })
    .onConflictDoUpdate({
      target: [saga_runs.saga_type, saga_runs.correlation_key],
      set: {
        status: "COMPLETED",
        current_step: stepName,
        last_error: null,
        updated_at: new Date(),
      },
    });
}

function classifyQboError(
  error: unknown,
):
  | { kind: "park"; reason: KatanaPoBillParkReason; message: string }
  | { kind: "retry_after"; message: string }
  | { kind: "non_retriable"; message: string }
  | { kind: "rethrow" } {
  if (error instanceof QboConfigError) {
    return { kind: "park", reason: "config_missing", message: error.message };
  }
  if (error instanceof QboAuthError) {
    return { kind: "non_retriable", message: error.message };
  }
  if (error instanceof QboApiError) {
    if (error.status === 429) {
      return { kind: "retry_after", message: error.message };
    }
    if (error.status === 400 || error.status === 422) {
      return { kind: "park", reason: "qbo_rejected", message: error.message };
    }
  }
  return { kind: "rethrow" };
}

export async function runPostKatanaPoBill(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PoBillPostStepLike;
    runId?: string;
  },
  deps: {
    getDb?: () => MiddlewareDb;
    qbo?: Partial<QboPostDeps>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const qbo: QboPostDeps = { ...defaultQboDeps, ...(deps.qbo ?? {}) };
  const env = deps.env ?? process.env;
  const runId = input.runId ?? "run_post_po_bill";

  const billRowId = String(input.event.data?.billRowId ?? "").trim();
  const supplierNameHint =
    typeof input.event.data?.supplierName === "string"
      ? input.event.data.supplierName.trim()
      : "";
  if (!billRowId) {
    throw new NonRetriableError(
      `${KATANA_PO_BILL_POST_EVENT} requires billRowId`,
    );
  }

  // Step 1: Load bill row (§VI R-6.1).
  const row = await input.step.run("load-bill-row", async () => {
    const [found] = await resolveDb()
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, billRowId))
      .limit(1);
    return found ?? null;
  });

  if (!row) {
    throw new NonRetriableError(`katana_po_bills row ${billRowId} does not exist`);
  }
  if (row.status === "posted") {
    return { ok: true as const, duplicate: true as const, qboBillId: row.qbo_bill_id };
  }
  if (row.status === "requires_manual_intervention") {
    return { ok: true as const, parked: true as const, parkReason: row.park_reason };
  }
  if (row.status !== "pending") {
    return { ok: true as const, skipped: row.status };
  }

  // Reopened `po_frozen` row with 0 delta needs no QBO Bill (§VII S-6.1/S-6.4).
  if (row.delta_total_cents === 0 && row.lines.length === 0) {
    await input.step.run("mark-zero-delta-complete", async () => {
      const db = resolveDb();
      await db
        .update(katana_po_bills)
        .set({ status: "no_delta", last_error: null, updated_at: new Date() })
        .where(eq(katana_po_bills.id, row.id));
      await markSagaCompletedOnDb(db, `${row.katana_po_id}:${row.receipt_seq}`, "no_delta");
    });
    return { ok: true as const, skipped: "no_delta" as const };
  }

  const parkAndFail = async (
    parkReason: KatanaPoBillParkReason,
    detailMessage: string,
  ): Promise<never> => {
    const cliHint =
      parkReason === "price_drift"
        ? `npm run ops:po-bills -- retry --id ${row.id} --approve-price-drift --operator <email> --execute`
        : `npm run ops:po-bills -- retry --id ${row.id} --operator <email> --execute`;
    const fullMessage = `${detailMessage} Next step: ${cliHint}`;
    await input.step.run("park-manual-intervention", () =>
      parkBillRow(resolveDb(), row, parkReason, runId, fullMessage),
    );
    throw new NonRetriableError(fullMessage);
  };

  // Step 2: Fail-closed ledger config check before any QBO I/O (§VI R-6.2).
  const configCheck = await input.step.run("assert-ledger-config", async () =>
    checkLedgerPostConfig(env),
  );
  if (!configCheck.ok) {
    return parkAndFail("config_missing", configCheck.message);
  }

  // Step 3: Validate Katana-supplied vendor id against QBO (§VII S-2.5).
  if (row.vendor_ref_error || !row.qbo_vendor_id) {
    const errReason = (row.vendor_ref_error ??
      "vendor_qbo_id_missing") as KatanaPoBillParkReason;
    return parkAndFail(
      errReason,
      `Katana supplier ${row.katana_supplier_id ?? "unknown"} has no valid "QBO_ID: <id>" line in its Comment field (${errReason}). Add it in Katana.`,
    );
  }

  const qboVendorId = row.qbo_vendor_id;
  const vendorOutcome = await input.step.run("resolve-vendor", async () => {
    try {
      const vendor = await qbo.fetchVendorById(qboVendorId);
      if (!vendor) {
        return {
          ok: false as const,
          reason: "vendor_qbo_id_not_found" as KatanaPoBillParkReason,
          message: `QuickBooks Vendor Id ${qboVendorId} was not found in the active QBO company.`,
        };
      }
      if (!vendor.active) {
        return {
          ok: false as const,
          reason: "vendor_inactive" as KatanaPoBillParkReason,
          message: `QuickBooks Vendor Id ${qboVendorId} is inactive.`,
        };
      }
      if (vendor.currency && vendor.currency.toUpperCase() !== "USD") {
        return {
          ok: false as const,
          reason: "vendor_currency_mismatch" as KatanaPoBillParkReason,
          message: `QuickBooks Vendor Id ${qboVendorId} uses currency "${vendor.currency}" instead of USD.`,
        };
      }
      if (
        supplierNameHint &&
        vendor.displayName &&
        vendor.displayName.trim().toLowerCase() !== supplierNameHint.toLowerCase()
      ) {
        logStructured("warn", "katana-qbo-vendor-name-mismatch", {
          katanaSupplierId: row.katana_supplier_id,
          qboVendorId,
          katanaName: supplierNameHint,
          qboDisplayName: vendor.displayName,
        });
      }
      return { ok: true as const };
    } catch (error) {
      const mapped = classifyQboError(error);
      if (mapped.kind === "retry_after") {
        throw new RetryAfterError(mapped.message, "60s");
      }
      if (mapped.kind === "non_retriable") {
        throw new NonRetriableError(mapped.message);
      }
      if (mapped.kind === "park") {
        return {
          ok: false as const,
          reason: mapped.reason,
          message: mapped.message,
        };
      }
      throw error;
    }
  });

  if (!vendorOutcome.ok) {
    return parkAndFail(vendorOutcome.reason, vendorOutcome.message);
  }

  const docNumber = formatPoBillDocNumber(row.order_no, row.receipt_seq);

  // Step 4: Reconcile existing Bill by DocNumber before POSTing (§VI R-7.2).
  const reconcileOutcome = await input.step.run(
    "reconcile-existing-bill",
    async () => {
      try {
        const existingBills = await qbo.findBillsByDocNumber(docNumber);
        if (existingBills.length === 0) {
          return { state: "none" as const };
        }
        const exact = existingBills.find(
          (b) =>
            b.vendorId === qboVendorId && b.totalCents === row.delta_total_cents,
        );
        if (exact && existingBills.length === 1) {
          return { state: "adopted" as const, billId: exact.id };
        }
        return {
          state: "mismatch" as const,
          message: `QBO Bill with DocNumber "${docNumber}" already exists with different vendor or total.`,
        };
      } catch (error) {
        const mapped = classifyQboError(error);
        if (mapped.kind === "retry_after") {
          throw new RetryAfterError(mapped.message, "60s");
        }
        if (mapped.kind === "non_retriable") {
          throw new NonRetriableError(mapped.message);
        }
        if (mapped.kind === "park") {
          return { state: "error_park" as const, reason: mapped.reason, message: mapped.message };
        }
        throw error;
      }
    },
  );

  if (reconcileOutcome.state === "mismatch") {
    return parkAndFail("qbo_bill_mismatch", reconcileOutcome.message);
  }
  if (reconcileOutcome.state === "error_park") {
    return parkAndFail(reconcileOutcome.reason, reconcileOutcome.message);
  }

  let qboBillId: string;
  if (reconcileOutcome.state === "adopted") {
    qboBillId = reconcileOutcome.billId;
  } else {
    const createdAtValue = row.created_at as Date | string;
    const createdAtMs =
      createdAtValue instanceof Date
        ? createdAtValue.getTime()
        : Date.parse(String(createdAtValue));
    const txnDate =
      typeof row.receipt_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.receipt_date)
        ? row.receipt_date
        : formatEpochMsInZone(createdAtMs, configCheck.timeZone);

    // Step 5: POST A/P Vendor Bill to QBO (§VI R-7.3).
    const postOutcome = await input.step.run("post-qbo-vendor-bill", async () => {
      try {
        const result = await qbo.createVendorBill({
          katanaPoId: row.katana_po_id,
          orderNo: row.order_no,
          qboVendorId,
          requestId: row.qbo_request_id,
          docNumber,
          txnDate,
          lines: row.lines,
        });
        return { ok: true as const, billId: result.billId };
      } catch (error) {
        const mapped = classifyQboError(error);
        if (mapped.kind === "retry_after") {
          throw new RetryAfterError(mapped.message, "60s");
        }
        if (mapped.kind === "non_retriable") {
          throw new NonRetriableError(mapped.message);
        }
        if (mapped.kind === "park") {
          return {
            ok: false as const,
            reason: mapped.reason,
            message: mapped.message,
          };
        }
        throw error;
      }
    });

    if (!postOutcome.ok) {
      return parkAndFail(postOutcome.reason, postOutcome.message);
    }
    qboBillId = postOutcome.billId;
  }

  // Step 6: Mark row posted and complete saga.
  await input.step.run("mark-posted", async () => {
    const db = resolveDb();
    await db
      .update(katana_po_bills)
      .set({
        status: "posted",
        qbo_bill_id: qboBillId,
        last_error: null,
        updated_at: new Date(),
      })
      .where(eq(katana_po_bills.id, row.id));

    await markSagaCompletedOnDb(db, `${row.katana_po_id}:${row.receipt_seq}`, "posted");
  });

  return {
    ok: true as const,
    posted: true as const,
    reconciled: reconcileOutcome.state === "adopted",
    qboBillId,
    qboVendorId,
    docNumber,
  };
}

export const postKatanaPoBill = inngest.createFunction(
  {
    id: "post-katana-po-bill",
    name: "Post Katana PO Delta Bill -> QuickBooks Online",
    triggers: [{ event: KATANA_PO_BILL_POST_EVENT }],
    // Intentionally NO function-level `idempotency` (§VII S-3: allows redrive within 24h).
    concurrency: [
      { limit: 1, key: "event.data.katanaPoId" },
      { limit: 2, key: '"qbo-realm"', scope: "env" },
    ],
    retries: 5,
  },
  async ({ event, step, runId }) =>
    runPostKatanaPoBill({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PoBillPostStepLike,
      runId,
    }),
);

export async function runRedriveKatanaPoBill(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PoBillPostStepLike;
  },
  deps: { getDb?: () => MiddlewareDb } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const billRowId = String(input.event.data?.billRowId ?? "").trim();
  const katanaPoId = Number(input.event.data?.katanaPoId ?? 0);
  const expectedRedriveCount = Number(input.event.data?.expectedRedriveCount ?? -1);
  const operator = String(input.event.data?.operator ?? "").trim();
  const approvePriceDrift = Boolean(input.event.data?.approvePriceDrift);

  if (
    !billRowId ||
    !Number.isInteger(katanaPoId) ||
    katanaPoId <= 0 ||
    !Number.isInteger(expectedRedriveCount) ||
    expectedRedriveCount < 0 ||
    !operator
  ) {
    throw new NonRetriableError(
      `${KATANA_PO_BILL_REDRIVE_EVENT} missing required fields`,
    );
  }

  const transition = await input.step.run("load-and-transition-parked-row", async () => {
    const db = resolveDb();
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(katana_po_bills)
        .where(eq(katana_po_bills.id, billRowId))
        .limit(1);

      if (!row || row.status !== "requires_manual_intervention") {
        return { outcome: "skipped" as const, reason: "not_parked" as const };
      }
      if (row.redrive_count !== expectedRedriveCount) {
        return { outcome: "skipped" as const, reason: "stale_redrive" as const };
      }

      const poRows = await tx
        .select({
          id: katana_po_bills.id,
          status: katana_po_bills.status,
          park_reason: katana_po_bills.park_reason,
        })
        .from(katana_po_bills)
        .where(eq(katana_po_bills.katana_po_id, row.katana_po_id));

      const hasOpenNegativeReceiptOnPo = poRows.some(
        (r) =>
          r.id !== row.id &&
          r.status === "requires_manual_intervention" &&
          r.park_reason === "negative_receipt",
      );

      const eligibility = evaluateRetryEligibility({
        parkReason: row.park_reason,
        approvePriceDrift,
        hasOpenNegativeReceiptOnPo,
      });

      if (!eligibility.ok) {
        const entry: KatanaPoBillRedriveEntry = {
          seq: expectedRedriveCount + 1,
          at: new Date().toISOString(),
          operator,
          action: "retry",
          parkReason: row.park_reason,
          previousRequestId: row.qbo_request_id,
          previousError: row.last_error,
          outcome: `refused:${eligibility.reason}`,
        };
        await tx
          .update(katana_po_bills)
          .set({
            redrive_log: [...(row.redrive_log ?? []), entry],
            updated_at: new Date(),
          })
          .where(
            and(
              eq(katana_po_bills.id, billRowId),
              eq(katana_po_bills.status, "requires_manual_intervention"),
              eq(katana_po_bills.redrive_count, expectedRedriveCount),
            ),
          );
        return { outcome: "refused" as const, reason: eligibility.reason };
      }

      if (eligibility.needsVendorRefresh) {
        return { outcome: "needs_vendor_refresh" as const };
      }

      const nextCount = expectedRedriveCount + 1;
      const nextRequestId = derivePoBillRequestId(
        row.katana_po_id,
        row.receipt_fingerprint,
        nextCount,
      );
      const entry: KatanaPoBillRedriveEntry = {
        seq: nextCount,
        at: new Date().toISOString(),
        operator,
        action: approvePriceDrift ? "retry_approve_price_drift" : "retry",
        parkReason: row.park_reason,
        previousRequestId: row.qbo_request_id,
        previousError: row.last_error,
        outcome: "reopened",
      };

      const updated = await tx
        .update(katana_po_bills)
        .set({
          status: "pending",
          redrive_count: nextCount,
          qbo_request_id: nextRequestId,
          last_error: null,
          redrive_log: [...(row.redrive_log ?? []), entry],
          ...(approvePriceDrift
            ? {
                price_drift_approved_by: operator,
                price_drift_approved_at: new Date(),
              }
            : {}),
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

      await tx
        .insert(saga_runs)
        .values({
          saga_type: KATANA_PO_BILL_SAGA_TYPE,
          correlation_key: `${row.katana_po_id}:${row.receipt_seq}`,
          status: "IN_PROGRESS",
          current_step: `redriven_r${nextCount}`,
          last_error: null,
        })
        .onConflictDoUpdate({
          target: [saga_runs.saga_type, saga_runs.correlation_key],
          set: {
            status: "IN_PROGRESS",
            current_step: `redriven_r${nextCount}`,
            last_error: null,
            updated_at: new Date(),
          },
        });

      if (row.parked_run_id) {
        await tx
          .update(dlq_events)
          .set({
            status: "resolved",
            updated_at: new Date(),
          })
          .where(
            and(
              eq(dlq_events.run_id, row.parked_run_id),
              eq(dlq_events.status, "open"),
            ),
          );
      }

      return { outcome: "reopened" as const, redriveSeq: nextCount };
    });
  });

  if (transition.outcome === "needs_vendor_refresh") {
    await input.step.sendEvent("request-vendor-refresh", {
      id: `katana-po-bill-vendor:${billRowId}:${expectedRedriveCount + 1}`,
      name: KATANA_PO_BILL_VENDOR_REFRESH_EVENT,
      data: {
        billRowId,
        katanaPoId,
        expectedRedriveCount,
        operator,
      },
    });
    return { ok: true as const, requestedVendorRefresh: true as const };
  }

  if (transition.outcome !== "reopened") {
    return { ok: true as const, ...transition };
  }

  await input.step.sendEvent("request-qbo-bill", {
    id: `katana-po-bill:${billRowId}:r${transition.redriveSeq}`,
    name: KATANA_PO_BILL_POST_EVENT,
    data: {
      billRowId,
      katanaPoId,
      redriveSeq: transition.redriveSeq,
    },
  });

  return {
    ok: true as const,
    reopened: true as const,
    redriveSeq: transition.redriveSeq,
  };
}

export const redriveKatanaPoBill = inngest.createFunction(
  {
    id: "redrive-katana-po-bill",
    name: "Redrive Parked Katana PO Bill",
    triggers: [{ event: KATANA_PO_BILL_REDRIVE_EVENT }],
    concurrency: [{ limit: 1, key: "event.data.katanaPoId" }],
    retries: 3,
  },
  async ({ event, step }) =>
    runRedriveKatanaPoBill({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PoBillPostStepLike,
    }),
);

export async function runResolveKatanaPoBill(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PoBillPostStepLike;
  },
  deps: {
    getDb?: () => MiddlewareDb;
    qbo?: Partial<QboPostDeps>;
  } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const qbo: QboPostDeps = { ...defaultQboDeps, ...(deps.qbo ?? {}) };

  const billRowId = String(input.event.data?.billRowId ?? "").trim();
  const expectedRedriveCount = Number(input.event.data?.expectedRedriveCount ?? -1);
  const resolutionKind = String(
    input.event.data?.resolutionKind ?? "",
  ).trim() as KatanaPoBillResolutionKind;
  const qboRef =
    typeof input.event.data?.qboRef === "string" && input.event.data.qboRef.trim()
      ? input.event.data.qboRef.trim()
      : null;
  const note = String(input.event.data?.note ?? "").trim();
  const operator = String(input.event.data?.operator ?? "").trim();
  const allowAmountDifference = Boolean(input.event.data?.allowAmountDifference);

  if (
    !billRowId ||
    !Number.isInteger(expectedRedriveCount) ||
    expectedRedriveCount < 0 ||
    !operator ||
    !resolutionKind
  ) {
    throw new NonRetriableError(
      `${KATANA_PO_BILL_RESOLVE_EVENT} missing required fields`,
    );
  }

  const loaded = await input.step.run("load-parked-row", async () => {
    const db = resolveDb();
    const [row] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, billRowId))
      .limit(1);
    if (!row) return { state: "missing" as const };
    if (row.status !== "requires_manual_intervention") {
      return { state: "not_parked" as const };
    }
    if (row.redrive_count !== expectedRedriveCount) {
      return { state: "stale_redrive" as const };
    }

    const poRows = await db
      .select({
        id: katana_po_bills.id,
        status: katana_po_bills.status,
        park_reason: katana_po_bills.park_reason,
      })
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, row.katana_po_id));

    const hasPoFrozenRowsOnPo = poRows.some(
      (r) =>
        r.id !== row.id &&
        r.status === "requires_manual_intervention" &&
        r.park_reason === "po_frozen",
    );

    return { state: "ok" as const, row, hasPoFrozenRowsOnPo };
  });

  if (loaded.state === "missing") {
    throw new NonRetriableError(`katana_po_bills row ${billRowId} does not exist`);
  }
  if (loaded.state !== "ok") {
    return { ok: true as const, skipped: loaded.state };
  }

  const { row, hasPoFrozenRowsOnPo } = loaded;
  const eligibility = evaluateResolveEligibility({
    parkReason: row.park_reason,
    resolutionKind,
    qboRef,
    note,
    hasPoFrozenRowsOnPo,
  });

  const appendRefusal = async (reason: string) => {
    await input.step.run("record-resolve-refusal", async () => {
      const db = resolveDb();
      const entry: KatanaPoBillRedriveEntry = {
        seq: expectedRedriveCount + 1,
        at: new Date().toISOString(),
        operator,
        action: `resolve:${resolutionKind}`,
        parkReason: row.park_reason,
        previousRequestId: row.qbo_request_id,
        previousError: row.last_error,
        outcome: `refused:${reason}`,
      };
      await db
        .update(katana_po_bills)
        .set({
          redrive_log: [...(row.redrive_log ?? []), entry],
          updated_at: new Date(),
        })
        .where(
          and(
            eq(katana_po_bills.id, billRowId),
            eq(katana_po_bills.status, "requires_manual_intervention"),
            eq(katana_po_bills.redrive_count, expectedRedriveCount),
          ),
        );
    });
    return { ok: true as const, refused: true as const, reason };
  };

  if (!eligibility.ok) {
    return appendRefusal(eligibility.reason);
  }

  // Step 2: Verify QBO document outside any DB transaction (§VII S-4.3, §VI R-5.2).
  let expectedCreditCents = 0;
  if (resolutionKind === "vendor_credit_issued") {
    for (const line of row.lines) {
      if (line.decreaseQtyE4 && line.decreaseQtyE4 > 0) {
        expectedCreditCents += roundHalfUpFromE4(
          line.decreaseQtyE4,
          line.pricePerUnitCents,
        );
      }
    }
  }

  if (resolutionKind === "entered_by_hand" && qboRef) {
    const verifyBill = await input.step.run("verify-qbo-document", async () => {
      const bill = await qbo.fetchBillById(qboRef);
      if (!bill) return { ok: false as const, reason: "qbo_bill_not_found" };
      if (row.qbo_vendor_id && bill.vendorId !== row.qbo_vendor_id) {
        return { ok: false as const, reason: "qbo_bill_vendor_mismatch" };
      }
      if (!allowAmountDifference && bill.totalCents !== row.delta_total_cents) {
        return { ok: false as const, reason: "qbo_bill_amount_mismatch" };
      }
      return { ok: true as const, amountDiffAllowed: bill.totalCents !== row.delta_total_cents };
    });
    if (!verifyBill.ok) {
      return appendRefusal(verifyBill.reason);
    }
  } else if (resolutionKind === "vendor_credit_issued" && qboRef) {
    const verifyCredit = await input.step.run("verify-qbo-document", async () => {
      const credit = await qbo.fetchVendorCreditById(qboRef);
      if (!credit) return { ok: false as const, reason: "qbo_vendor_credit_not_found" };
      if (row.qbo_vendor_id && credit.vendorId !== row.qbo_vendor_id) {
        return { ok: false as const, reason: "qbo_vendor_credit_vendor_mismatch" };
      }
      if (credit.totalCents !== expectedCreditCents) {
        return { ok: false as const, reason: "qbo_vendor_credit_amount_mismatch" };
      }
      return { ok: true as const };
    });
    if (!verifyCredit.ok) {
      return appendRefusal(verifyCredit.reason);
    }
  }

  // Step 3: Compare-and-set mark resolved (§VII S-4.3 & S-6.4).
  const marked = await input.step.run("mark-resolved", async () => {
    const db = resolveDb();
    return db.transaction(async (tx) => {
      const nextCount = expectedRedriveCount + 1;
      const outcomeNote =
        resolutionKind === "entered_by_hand" && allowAmountDifference
          ? `resolved:${resolutionKind}:allow_amount_difference:${note}`
          : `resolved:${resolutionKind}:${note}`;

      const entry: KatanaPoBillRedriveEntry = {
        seq: nextCount,
        at: new Date().toISOString(),
        operator,
        action: `resolve:${resolutionKind}`,
        parkReason: row.park_reason,
        previousRequestId: row.qbo_request_id,
        previousError: row.last_error,
        outcome: outcomeNote,
      };

      let nextLines: KatanaPoBillLine[] = row.lines;
      let nextDeltaCents = row.delta_total_cents;

      if (resolutionKind === "vendor_credit_issued") {
        const adjustmentLines: KatanaPoBillLine[] = row.lines
          .filter((l) => typeof l.decreaseQtyE4 === "number" && l.decreaseQtyE4 > 0)
          .map((l) => {
            const decE4 = l.decreaseQtyE4!;
            const creditAmt = roundHalfUpFromE4(decE4, l.pricePerUnitCents);
            return {
              rowId: l.rowId,
              sku: l.sku,
              description: `${l.description} (VendorCredit ${qboRef})`,
              receivedQtyCumulative: l.receivedQtyCumulative,
              billedQtyBefore: l.billedQtyBefore,
              billedQtyDelta: -fromQtyE4(decE4),
              pricePerUnitCents: l.pricePerUnitCents,
              amountCents: -creditAmt,
            };
          });
        nextLines = [...row.lines, ...adjustmentLines];
        nextDeltaCents = -expectedCreditCents;
      }

      const now = new Date();
      const updated = await tx
        .update(katana_po_bills)
        .set({
          status: "resolved_manually",
          resolution_kind: resolutionKind,
          resolution_ref: qboRef ?? note.slice(0, 200),
          resolved_by: operator,
          resolved_at: now,
          ...(resolutionKind === "entered_by_hand" && qboRef
            ? { qbo_bill_id: qboRef }
            : {}),
          lines: nextLines,
          delta_total_cents: nextDeltaCents,
          redrive_count: nextCount,
          redrive_log: [...(row.redrive_log ?? []), entry],
          last_error: null,
          updated_at: now,
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
        return { outcome: "stale_redrive" as const };
      }

      await markSagaCompletedOnDb(
        tx as unknown as MiddlewareDb,
        `${row.katana_po_id}:${row.receipt_seq}`,
        "resolved_manually",
      );

      if (row.parked_run_id) {
        await tx
          .update(dlq_events)
          .set({
            status: "resolved",
            updated_at: now,
          })
          .where(
            and(
              eq(dlq_events.run_id, row.parked_run_id),
              eq(dlq_events.status, "open"),
            ),
          );
      }

      return { outcome: "resolved" as const };
    });
  });

  if (marked.outcome !== "resolved") {
    return { ok: true as const, skipped: marked.outcome };
  }

  return {
    ok: true as const,
    resolved: true as const,
    resolutionKind,
  };
}

export const resolveKatanaPoBill = inngest.createFunction(
  {
    id: "resolve-katana-po-bill",
    name: "Resolve Parked Katana PO Bill Manually",
    triggers: [{ event: KATANA_PO_BILL_RESOLVE_EVENT }],
    concurrency: [
      { limit: 1, key: "event.data.katanaPoId" },
      { limit: 2, key: '"qbo-realm"', scope: "env" },
    ],
    retries: 5,
  },
  async ({ event, step }) =>
    runResolveKatanaPoBill({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PoBillPostStepLike,
    }),
);
