/**
 * Async CAD convert handoff helper for Inngest functions (Task 4C).
 * Dispatches async conversion (HTTP 202), waits for signed callback via bounded wait,
 * reconciles race conditions, verifies SHA-256, and updates job-bound saga/item state.
 * Never logs secrets or signed URLs.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { getDb } from "@/server/db/client";
import { cad_uploads, incoming_webhooks, saga_runs } from "@/server/db/schema";
import {
  createCadSignedUpload,
  downloadCadObject,
} from "@/lib/supabase-storage";
import {
  classifyCustomSku,
  type SkuCustomClassification,
} from "@/server/path-a/katana-fence";
import { createItemStore, type ItemStore } from "@/server/path-a/item-store";
import {
  createReleaseStore,
  SagaDesignLockedError,
  type ReleaseDb,
  type ReleaseStore,
} from "@/server/path-a/release-store";
import { createSagaStore, type SagaStore } from "@/server/sre/saga-store";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";
import { CAD_CONVERT_COMPLETED_EVENT } from "@/server/path-a/events";

type InngestStepTools = Parameters<
  Parameters<typeof inngest.createFunction>[1]
>[0]["step"];

export type CadIntakeStep = Pick<InngestStepTools, "run">;
export type CadConvertStep = Pick<InngestStepTools, "run" | "waitForEvent">;

export type CadHandoffData = {
  uploadId: string;
  globalSku: string;
  storagePath: string;
  ext: "blend" | "dae" | "skp" | "glb";
  sha256?: string;
  operatorEmail?: string;
  replaceImage?: boolean;
};

export type CadHandoffDeps = {
  downloadCadObject?: (storagePath: string) => Promise<Buffer>;
  createCadSignedUpload?: (input: {
    globalSku: string;
    ext: string;
  }) => Promise<{ path: string; token: string; signedUrl: string }>;
  fetch?: typeof fetch;
  getAppUrl?: () => string;
  getConvertUrl?: () => string;
  getConvertToken?: () => string | undefined;
  getTimeoutMinutes?: () => number;
  itemStore?: ItemStore;
  releaseStore?: ReleaseStore;
  sagaStore?: SagaStore;
  db?: ReleaseDb;
};

/**
 * Job-bound CAD upload intake (Path A state bookkeeping), run for EVERY CAD extension (QCA M4).
 *
 * Previously this lived inside `runCadConvertHandoff`, which only runs for `.blend`; a `.glb` /
 * `.dae` / `.skp` re-upload on a job-bound SKU therefore skipped the change-order rejection and
 * never created the saga/item rows that `post-extract-advance` later assumes exist.
 *
 * Returns the bound GHL opportunity id, or null for catalog / non-job-bound SKUs.
 */
export async function runCadIntake(params: {
  step: CadIntakeStep;
  data: Pick<CadHandoffData, "uploadId" | "globalSku">;
  deps?: Pick<CadHandoffDeps, "db" | "itemStore" | "releaseStore" | "sagaStore">;
}): Promise<{ opportunityId: string | null }> {
  const { step, data, deps = {} } = params;
  const db = deps.db ?? getDb();
  const itemStore = deps.itemStore ?? createItemStore(() => db);
  const releaseStore = deps.releaseStore ?? createReleaseStore(() => db);
  const sagaStore = deps.sagaStore ?? createSagaStore(() => db);

  return step.run("cad-intake", async () => {
    const classification: SkuCustomClassification = await classifyCustomSku(
      data.globalSku,
      () => db,
    );

    if (classification.type !== "custom_job_bound") {
      return { opportunityId: null };
    }

    const oppId = classification.opportunityId;
    const currentSaga = await releaseStore.getSaga(oppId);

    // Re-upload past the pause is rejected as a change order
    if (
      currentSaga &&
      (currentSaga.status === "IN_PROGRESS" ||
        currentSaga.status === "COMPLETED" ||
        (currentSaga.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" &&
          currentSaga.release_requested_at))
    ) {
      throw new NonRetriableError(
        "order already released, a design change is a change order",
      );
    }

    const existingItem = await itemStore.findItemBySku(data.globalSku);

    if (existingItem?.design_status === "finalized" && currentSaga?.status === "AWAITING_DEPOSIT") {
      await releaseStore.revertToDesigning(oppId, "cad_dispatched");
      await itemStore.setItemStatus({
        globalSku: data.globalSku,
        from: "finalized",
        to: "awaiting_cad",
        cadUploadId: data.uploadId,
      });
    } else {
      await sagaStore.insertOnce({
        sagaType: PATH_A_SAGA_TYPE,
        correlationKey: oppId,
        status: "PENDING",
        currentStep: "designing",
      });
      await itemStore.ensureItem({
        jobId: classification.jobId,
        globalSku: data.globalSku,
        cadUploadId: data.uploadId,
      });
      await itemStore.setItemStatus({
        globalSku: data.globalSku,
        from: ["awaiting_cad", "needs_review", "cad_failed"],
        to: "awaiting_cad",
        cadUploadId: data.uploadId,
      });
      await sagaStore.setStep(PATH_A_SAGA_TYPE, oppId, "cad_dispatched");
    }

    return { opportunityId: oppId };
  });
}

export async function runCadConvertHandoff(params: {
  step: CadConvertStep;
  data: CadHandoffData;
  deps?: CadHandoffDeps;
}): Promise<{ ok: true; glbStoragePath: string } | { ok: false; error: string }> {
  const { step, data, deps = {} } = params;
  const db = deps.db ?? getDb();
  const downloadFn = deps.downloadCadObject ?? downloadCadObject;
  const signedUploadFn = deps.createCadSignedUpload ?? createCadSignedUpload;
  const fetchFn = deps.fetch ?? fetch;
  const configuredAppUrl = (deps.getAppUrl?.() ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const convertBaseUrl = (deps.getConvertUrl?.() ?? process.env.CAD_CONVERT_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const convertToken = deps.getConvertToken?.() ?? process.env.CAD_CONVERT_TOKEN;
  const itemStore = deps.itemStore ?? createItemStore(() => db);
  const sagaStore = deps.sagaStore ?? createSagaStore(() => db);

  const timeoutMinutes = Math.min(
    Math.max(Number(deps.getTimeoutMinutes?.() ?? process.env.CAD_CONVERT_TIMEOUT_MINUTES ?? 30), 1),
    120,
  );

  // Step 1: dispatch conversion (item/saga bookkeeping is done earlier by runCadIntake)
  const dispatchResult = await step.run("dispatch-convert", async () => {
    // The converter calls back to this host. A guessed production host would silently send
    // callbacks to the wrong environment, so an unconfigured host is a hard, non-retriable error.
    if (!configuredAppUrl) {
      throw new NonRetriableError(
        "NEXT_PUBLIC_APP_URL is not configured: cannot build the CAD callback URL",
      );
    }
    const appUrl = configuredAppUrl.replace(/\/$/, "");

    // Prepare signed GLB upload target
    const signed = await signedUploadFn({
      globalSku: data.globalSku,
      ext: "glb",
    });

    const callbackUrl = `${appUrl}/api/webhooks/cad-callback`;
    const sourceBuffer = await downloadFn(data.storagePath);

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(sourceBuffer)]),
      `upload-${data.uploadId}.blend`,
    );
    formData.append("job_id", data.uploadId);
    formData.append("upload_id", data.uploadId);
    formData.append("callback_url", callbackUrl);
    formData.append("result_upload_url", signed.signedUrl);

    const headers: Record<string, string> = {};
    if (convertToken) {
      headers["Authorization"] = `Bearer ${convertToken}`;
    }

    const res = await fetchFn(`${convertBaseUrl}/convert/async`, {
      method: "POST",
      body: formData,
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 202) {
      return { targetStoragePath: signed.path };
    }

    if (res.status >= 400 && res.status < 500) {
      const errText = await res.text().catch(() => "");
      throw new NonRetriableError(`CAD convert service rejected request (${res.status}): ${errText}`);
    }

    throw new Error(`CAD convert service responded with status ${res.status}`);
  });

  // Step 2: bounded wait on callback
  const callbackEvent = await step.waitForEvent("wait-cad-callback", {
    event: CAD_CONVERT_COMPLETED_EVENT,
    match: "data.uploadId",
    timeout: `${timeoutMinutes}m`,
  });

  // Step 3: Handle timeout / reconciliation
  if (!callbackEvent) {
    const reconciled = await step.run("reconcile-callback", async () => {
      const auditKey = `cad-callback:${data.uploadId}:succeeded`;
      const [auditRow] = await db
        .select()
        .from(incoming_webhooks)
        .where(eq(incoming_webhooks.idempotency_key, auditKey))
        .limit(1);

      if (auditRow) {
        return { recovered: true, payload: auditRow.payload as Record<string, unknown> | null };
      }

      // Mark upload failed and notify DLQ
      await db
        .update(cad_uploads)
        .set({
          status: "failed",
          error_message: "CONVERT_TIMEOUT",
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, data.uploadId));

      const classification = await classifyCustomSku(data.globalSku, () => db);
      if (classification.type === "custom_job_bound") {
        await itemStore.setItemStatus({
          globalSku: data.globalSku,
          from: ["awaiting_cad", "needs_review", "cad_failed"],
          to: "cad_failed",
        });
        await sagaStore.setStep(
          PATH_A_SAGA_TYPE,
          classification.opportunityId,
          "cad_failed:CONVERT_TIMEOUT",
        );
      }

      throw new NonRetriableError("CONVERT_TIMEOUT");
    });

    if (!reconciled?.recovered) {
      throw new NonRetriableError("CONVERT_TIMEOUT");
    }
  }

  const eventData = callbackEvent?.data ?? {};

  // Step 4: Handle failure callback
  if (eventData.status === "failed") {
    const errCode = eventData.errorCode || "CONVERT_FAILED";
    const errMsg = eventData.errorMessage || "Conversion failed";

    await step.run("mark-failed-callback", async () => {
      await db
        .update(cad_uploads)
        .set({
          status: "failed",
          error_message: `${errCode}: ${errMsg}`,
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, data.uploadId));

      const classification = await classifyCustomSku(data.globalSku, () => db);
      if (classification.type === "custom_job_bound") {
        await itemStore.setItemStatus({
          globalSku: data.globalSku,
          from: ["awaiting_cad", "needs_review", "cad_failed"],
          to: "cad_failed",
        });
        await sagaStore.setStep(
          PATH_A_SAGA_TYPE,
          classification.opportunityId,
          `cad_failed:${errCode}`,
        );
      }
    });

    return { ok: false, error: `${errCode}: ${errMsg}` };
  }

  // Step 5: Verify SHA256 on succeeded callback
  await step.run("verify-converted-glb", async () => {
    const downloadedGlb = await downloadFn(dispatchResult.targetStoragePath);
    const computedSha256 = crypto.createHash("sha256").update(downloadedGlb).digest("hex");

    if (eventData.resultSha256 && computedSha256 !== eventData.resultSha256) {
      throw new NonRetriableError("SHA256_MISMATCH");
    }
  });

  return { ok: true, glbStoragePath: dispatchResult.targetStoragePath };
}

export async function advanceSagaAfterExtract(input: {
  globalSku: string;
  opportunityId: string;
  itemStore: ItemStore;
  releaseStore: ReleaseStore;
}): Promise<void> {
  await input.itemStore.setItemStatus({
    globalSku: input.globalSku,
    from: ["awaiting_cad", "needs_review"],
    to: "needs_review",
  });
  try {
    await input.releaseStore.advanceSaga(input.opportunityId);
  } catch (err) {
    if (err instanceof SagaDesignLockedError) {
      throw new NonRetriableError(err.message, { cause: err });
    }
    throw err;
  }
}
