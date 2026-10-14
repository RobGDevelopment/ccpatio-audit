/**
 * Phase 11 Path A Release Request Ingress & Deposit Seam (Task 6).
 * Handles management override requests and customer deposit recording.
 * ZERO Katana imports. Fail-closed authorization stub.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { pim_audit_log } from "@/server/db/schema";
import { type PimSession } from "@/lib/pim-audit";
import { hasOverrideAuthority } from "./authz";
import {
  createReleaseStore,
  type ReleaseDb,
  type ReleaseStore,
} from "./release-store";
import {
  createSagaStore,
  type SagaStore,
} from "@/server/sre/saga-store";
import { PATH_A_SAGA_TYPE } from "./saga-state";
import {
  buildPathAReleaseEventData,
  PATH_A_RELEASE_TO_PRODUCTION_EVENT,
  pathAReleaseEventId,
} from "./events";
import { inngest } from "@/inngest/client";

/** Another actor/source already recorded the release request (internal; never shown to the UI). */
class ReleaseConflictError extends Error {}

export type ReleaseRequestDeps = {
  releaseStore?: ReleaseStore;
  /** Builds the release store bound to a transaction handle (defaults to createReleaseStore). */
  txReleaseStore?: (tx: ReleaseDb) => ReleaseStore;
  sagaStore?: SagaStore;
  inngestSend?: (event: Parameters<typeof inngest.send>[0]) => Promise<unknown>;
  db?: ReleaseDb;
};

export async function requestManagementOverride(
  input: {
    ghlOpportunityId: string;
    reason: string;
    session: PimSession | null | undefined;
  },
  deps: ReleaseRequestDeps = {},
): Promise<
  | { ok: true }
  | { ok: false; error: string; requested?: boolean; retryable?: boolean }
> {
  const { ghlOpportunityId, reason, session } = input;

  // 1. Authority check (defense in depth)
  if (!hasOverrideAuthority(session)) {
    return { ok: false, error: "not_authorized" };
  }

  // 2. Validate reason (10 to 500 characters)
  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    return {
      ok: false,
      error: "Reason must be between 10 and 500 characters",
    };
  }

  const db = deps.db ?? getDb();
  const releaseStore = deps.releaseStore ?? createReleaseStore(() => db);
  const sendFn = deps.inngestSend ?? ((e) => inngest.send(e));

  // 3. Inspect existing saga
  const saga = await releaseStore.getSaga(ghlOpportunityId);
  if (!saga) {
    return { ok: false, error: "No saga run found for opportunity" };
  }

  if (saga.status !== "AWAITING_DEPOSIT") {
    if (saga.status === "COMPLETED") {
      return { ok: false, error: "Already released" };
    }
    if (saga.status === "IN_PROGRESS") {
      return { ok: false, error: "Release already in progress" };
    }
    return { ok: false, error: "Design is not finalized yet" };
  }

  const operatorEmail = session!.email;

  // 4. ONE transaction: requestRelease + audit log insert
  const requestResult = await db.transaction(async (tx: ReleaseDb) => {
    const txReleaseStore = deps.txReleaseStore
      ? deps.txReleaseStore(tx)
      : createReleaseStore(() => tx);
    const result = await txReleaseStore.requestRelease({
      oppId: ghlOpportunityId,
      source: "management_override",
      requestedBy: operatorEmail,
      reason: trimmedReason,
    });

    if (result.outcome === "already_requested") {
      if (result.sameSource && result.requestedBy === operatorEmail) {
        // Idempotent re-request by same actor: allow through to re-send event
      } else {
        // Never put the other operator's identity or raw DB text into a UI-visible error.
        throw new ReleaseConflictError("release already requested by another actor");
      }
    }

    await tx.insert(pim_audit_log).values({
      operator_email: operatorEmail,
      action: "path_a_override",
      new_value: trimmedReason,
      global_sku: null,
    });

    return result;
  }).catch((err: unknown) => {
    return { failure: err };
  });

  if ("failure" in requestResult) {
    if (requestResult.failure instanceof ReleaseConflictError) {
      return { ok: false, error: "release_already_requested" };
    }
    console.error("[requestManagementOverride] release request transaction failed:", requestResult.failure);
    return { ok: false, error: "release_request_failed" };
  }

  // 5. Won or re-requested: bump attempt and send Inngest event
  const attempt = await releaseStore.bumpReleaseAttempt(ghlOpportunityId);
  const eventId =
    attempt === 1
      ? pathAReleaseEventId(ghlOpportunityId, "override")
      : pathAReleaseEventId(ghlOpportunityId, { retry: attempt });

  try {
    await sendFn({
      id: eventId,
      name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
      data: buildPathAReleaseEventData({
        ghlOpportunityId,
        source: "management_override",
        requestedBy: operatorEmail,
        reason: trimmedReason,
        attempt,
      }),
    });
  } catch (sendErr) {
    console.error("[requestManagementOverride] Inngest send error:", sendErr);
    return { ok: false, requested: true, retryable: true, error: "inngest_send_failed" };
  }

  return { ok: true };
}

export type RecordDepositResult =
  | { outcome: "released"; attempt: number }
  | { outcome: "recorded_early" }
  | { outcome: "recorded_already_requested" }
  | { outcome: "recorded_post_completion" }
  | { outcome: "invalid_input"; error: string };

export async function recordDepositAndRequestRelease(
  input: {
    ghlOpportunityId: string;
    depositCents: number;
    depositRef: string;
  },
  deps: ReleaseRequestDeps = {},
): Promise<RecordDepositResult> {
  const { ghlOpportunityId, depositCents, depositRef } = input;

  if (!Number.isInteger(depositCents) || depositCents <= 0) {
    return {
      outcome: "invalid_input",
      error: "Deposit amount must be a positive integer in cents",
    };
  }

  const cleanRef = depositRef?.trim() ?? "";
  if (!cleanRef) {
    return {
      outcome: "invalid_input",
      error: "Deposit reference is required",
    };
  }

  const db = deps.db ?? getDb();
  const releaseStore = deps.releaseStore ?? createReleaseStore(() => db);
  const sagaStore = deps.sagaStore ?? createSagaStore(() => db);
  const sendFn = deps.inngestSend ?? ((e) => inngest.send(e));

  // D8: insert saga row PENDING / deposit_received_early if none exists
  const existing = await releaseStore.getSaga(ghlOpportunityId);
  if (!existing) {
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: ghlOpportunityId,
      status: "PENDING",
      currentStep: "deposit_received_early",
    });
  }

  // Request release with source customer_deposit (records money regardless of race)
  const requested = await releaseStore.requestRelease({
    oppId: ghlOpportunityId,
    source: "customer_deposit",
    requestedBy: "system:deposit",
    depositCents,
    depositRef: cleanRef,
  });

  const currentSaga = await releaseStore.getSaga(ghlOpportunityId);
  if (currentSaga?.status === "COMPLETED") {
    return { outcome: "recorded_post_completion" };
  }

  // A request from ANOTHER source (e.g. a management override) already exists and already sent
  // its own release event. The deposit is recorded (requestRelease COALESCEs the money fields);
  // sending a second release event would double-trigger Function 2.
  if (requested.outcome === "already_requested" && !requested.sameSource) {
    return { outcome: "recorded_already_requested" };
  }

  if (currentSaga?.status === "AWAITING_DEPOSIT") {
    const attempt = await releaseStore.bumpReleaseAttempt(ghlOpportunityId);
    await sendFn({
      id: pathAReleaseEventId(ghlOpportunityId, { depositRef: cleanRef }),
      name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
      data: buildPathAReleaseEventData({
        ghlOpportunityId,
        source: "customer_deposit",
        requestedBy: "system:deposit",
        depositCents,
        depositRef: cleanRef,
        attempt,
      }),
    });
    return { outcome: "released", attempt };
  }

  // Still designing: money recorded, no event sent (Finalize will replay it)
  return { outcome: "recorded_early" };
}
