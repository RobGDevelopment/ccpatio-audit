"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getPimSession } from "@/lib/pim-audit";

/**
 * Saga states in which Function 2 owns (or has already failed) the release. The design is locked:
 * finalizing again would rewrite the recipe underneath a release in flight.
 * (Not exported: a "use server" module may only export async functions.)
 */
const DESIGN_LOCKED_SAGA_STATUSES: ReadonlySet<string> = new Set([
  "IN_PROGRESS",
  "COMPLETED",
  "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
]);

export async function finalizeDesignAction(input: {
  globalSku: string;
  quantity?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  blockingCodes?: string[];
  committed?: boolean;
  retryable?: boolean;
  dossierHash?: string;
}> {
  const session = await getPimSession();
  if (!session) {
    return { ok: false, error: "not_authenticated" };
  }

  const sku = input.globalSku.trim().toUpperCase();
  if (!sku) {
    return { ok: false, error: "SKU is required" };
  }

  const qty = input.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { ok: false, error: "Invalid quantity (must be an integer between 1 and 99)" };
  }

  const { classifyCustomSku } = await import("@/server/path-a/katana-fence");
  const classification = await classifyCustomSku(sku);
  if (classification.type !== "custom_job_bound") {
    return { ok: false, error: "Only custom_job_bound SKUs can be finalized via Path A" };
  }

  const oppId = classification.opportunityId;

  const { createItemStore } = await import("@/server/path-a/item-store");
  const { createReleaseStore } = await import("@/server/path-a/release-store");
  const releaseStore = createReleaseStore();

  // M8: once Function 2 has claimed (or failed) the release, the design is locked. Refuse BEFORE
  // touching the recipe so a re-click cannot rewrite BOM/finalization under a running release.
  const sagaBefore = await releaseStore.getSaga(oppId);
  if (sagaBefore && DESIGN_LOCKED_SAGA_STATUSES.has(sagaBefore.status)) {
    return { ok: false, error: "design_locked_release_started" };
  }

  const { finalizeDesignCore } = await import("@/server/factory-bom/finalize-design");
  const finalizeRes = await finalizeDesignCore(sku, { email: session.email });
  if (!finalizeRes.ok) {
    return {
      ok: false,
      error: finalizeRes.error,
      blockingCodes: finalizeRes.blockingCodes,
    };
  }

  const dossierHash = finalizeRes.dossierHash;

  // M8: item finalization + saga advance are ONE transaction. A crash between them can no longer
  // leave a finalized item behind a PENDING saga.
  const { getDb } = await import("@/server/db/client");
  let txOutcome;
  try {
    txOutcome = await getDb().transaction(async (tx) => {
      const txItemStore = createItemStore(() => tx);
      const txReleaseStore = createReleaseStore(() => tx);
      const itemResult = await txItemStore.setItemStatus({
        globalSku: sku,
        from: ["needs_review", "finalized"],
        to: "finalized",
        finalizedDossierHash: dossierHash,
        finalizedBy: session.email,
        finalizedAt: new Date(),
        quantity: qty,
      });
      if (!itemResult.updated) {
        return { itemUpdated: false as const };
      }
      return { itemUpdated: true as const, advance: await txReleaseStore.advanceSaga(oppId) };
    });
  } catch (err) {
    const { SagaDesignLockedError } = await import("@/server/path-a/release-store");
    if (err instanceof SagaDesignLockedError) {
      return { ok: false, error: "design_locked_release_started" };
    }
    throw err;
  }

  if (!txOutcome.itemUpdated) {
    return { ok: false, error: "Failed to transition item to finalized" };
  }
  const advanceRes = txOutcome.advance;

  const { inngest } = await import("@/inngest/client");
  const {
    PATH_A_DESIGN_FINALIZED_EVENT,
    PATH_A_RELEASE_TO_PRODUCTION_EVENT,
    buildPathAReleaseEventDataFromSaga,
    pathADesignFinalizedEventId,
    pathAReleaseEventId,
  } = await import("@/server/path-a/events");

  try {
    await inngest.send({
      id: pathADesignFinalizedEventId(sku, dossierHash),
      name: PATH_A_DESIGN_FINALIZED_EVENT,
      data: {
        globalSku: sku,
        dossierHash,
        opportunityId: oppId,
      },
    });

    if (
      advanceRes.status === "AWAITING_DEPOSIT" &&
      advanceRes.releaseRequestedAt
    ) {
      // Replay the request that was ALREADY recorded (override or early deposit): the payload is
      // rebuilt from the saga row and validated, never invented here.
      const recorded = await releaseStore.getSaga(oppId);
      const attempt = await releaseStore.bumpReleaseAttempt(oppId);
      await inngest.send({
        id: pathAReleaseEventId(oppId, { replay: attempt }),
        name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
        data: buildPathAReleaseEventDataFromSaga(
          oppId,
          recorded ?? {
            release_source: null,
            release_requested_by: null,
            release_reason: null,
            deposit_cents: null,
            deposit_ref: null,
          },
          attempt,
        ),
      });
    }
  } catch (err) {
    console.error("[finalizeDesignAction] Inngest send error:", err);
    return { ok: false, committed: true, retryable: true, dossierHash };
  }

  // Not wrapped in try/catch: a revalidation failure is a real error, and the events above are
  // already durably sent, so surfacing it cannot lose the finalize.
  revalidatePath("/admin/path-a");

  return { ok: true, dossierHash };
}

/**
 * UI Hint: checks if current session has management override authority.
 * Fails closed on any error.
 */
export async function canOverrideDesign(): Promise<{ allowed: boolean }> {
  try {
    const session = await getPimSession();
    const { hasOverrideAuthority } = await import("@/server/path-a/authz");
    return { allowed: hasOverrideAuthority(session) };
  } catch {
    return { allowed: false };
  }
}

/**
 * Server Action: requests management override for an opportunity.
 * Re-checks authority independently, never trusting client hint.
 */
export async function overrideDesignAction(input: {
  ghlOpportunityId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string; requested?: boolean; retryable?: boolean }> {
  const session = await getPimSession();
  const { hasOverrideAuthority } = await import("@/server/path-a/authz");
  if (!hasOverrideAuthority(session)) {
    return { ok: false, error: "not_authorized" };
  }

  const { requestManagementOverride } = await import("@/server/path-a/release-request");
  const result = await requestManagementOverride({
    ghlOpportunityId: input.ghlOpportunityId,
    reason: input.reason,
    session,
  });

  // Real errors from revalidation must surface (QCA m1); the request is already recorded.
  revalidatePath("/admin/path-a");

  return result;
}

/**
 * Server Action: retries a failed release for a saga in manual-failed state.
 * Requires override authority.
 */
export async function retryReleaseAction(input: {
  ghlOpportunityId: string;
}): Promise<{ ok: boolean; error?: string; attempt?: number }> {
  const session = await getPimSession();
  const { hasOverrideAuthority } = await import("@/server/path-a/authz");
  if (!hasOverrideAuthority(session)) {
    return { ok: false, error: "not_authorized" };
  }

  const oppId = input.ghlOpportunityId?.trim();
  if (!oppId) {
    return { ok: false, error: "Opportunity ID is required" };
  }

  const { createReleaseStore } = await import("@/server/path-a/release-store");
  const releaseStore = createReleaseStore();
  const saga = await releaseStore.getSaga(oppId);
  if (!saga) {
    return { ok: false, error: "No saga run found" };
  }

  const isManualFailed =
    saga.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" &&
    ((saga.current_step?.startsWith("manual:") ||
      saga.current_step?.startsWith("release_failed:")) ??
      false);
  if (!isManualFailed) {
    return { ok: false, error: "Only manual-failed releases can be retried" };
  }
  if (!saga.release_requested_at) {
    return { ok: false, error: "No release request on record for this opportunity" };
  }

  const {
    PATH_A_RELEASE_TO_PRODUCTION_EVENT,
    buildPathAReleaseEventDataFromSaga,
    pathAReleaseEventId,
  } = await import("@/server/path-a/events");

  // m2: a retry re-sends the request that is ALREADY recorded (source/requester/money), validated
  // through the event schema. If that record is incomplete, refuse instead of inventing one.
  try {
    buildPathAReleaseEventDataFromSaga(oppId, saga, 0);
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, error: "release_request_incomplete" };
    }
    throw err;
  }

  const attempt = await releaseStore.bumpReleaseAttempt(oppId);
  const { inngest } = await import("@/inngest/client");

  try {
    await inngest.send({
      id: pathAReleaseEventId(oppId, { retry: attempt }),
      name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
      data: buildPathAReleaseEventDataFromSaga(oppId, saga, attempt),
    });
  } catch (err) {
    console.error("[retryReleaseAction] Inngest send error:", err);
    return { ok: false, error: "inngest_send_failed" };
  }

  revalidatePath("/admin/path-a");

  return { ok: true, attempt };
}

/**
 * Server Action: requests GHL write-back re-sync.
 * Requires override authority.
 */
export async function resyncGhlAction(input: {
  ghlOpportunityId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getPimSession();
  const { hasOverrideAuthority } = await import("@/server/path-a/authz");
  if (!hasOverrideAuthority(session)) {
    return { ok: false, error: "not_authorized" };
  }

  const oppId = input.ghlOpportunityId?.trim();
  if (!oppId) {
    return { ok: false, error: "Opportunity ID is required" };
  }

  const { inngest } = await import("@/inngest/client");
  const { PATH_A_GHL_SYNC_REQUESTED_EVENT, pathAGhlSyncEventId } = await import(
    "@/server/path-a/events"
  );

  // M9: every operator re-sync is a distinct request. A constant discriminator made Inngest's
  // 24h event-id dedupe silently swallow every re-sync after the first.
  try {
    await inngest.send({
      id: pathAGhlSyncEventId(oppId, Date.now()),
      name: PATH_A_GHL_SYNC_REQUESTED_EVENT,
      data: {
        ghlOpportunityId: oppId,
      },
    });
  } catch (err) {
    console.error("[resyncGhlAction] Inngest send error:", err);
    return { ok: false, error: "inngest_send_failed" };
  }

  revalidatePath("/admin/path-a");

  return { ok: true };
}
