/**
 * Failure side effects for `process-cad-upload` once Inngest has exhausted its retries.
 *
 * Phase 11 remediation (QCA m1): this logic used to live inline in `onFailure` inside two empty
 * catch blocks, so a failure to record a failed CAD upload vanished without a trace. Both
 * side effects now ALWAYS run, and any failure is surfaced (the global DLQ alert remains the single
 * alerting authority; a thrown error here is visible in the Inngest run instead of being lost).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { cad_uploads } from "@/server/db/schema";
import { classifyCustomSku, type SkuCustomClassification } from "@/server/path-a/katana-fence";
import { createItemStore, type ItemStore } from "@/server/path-a/item-store";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";
import { createSagaStore, type SagaStore } from "@/server/sre/saga-store";

export type CadFailureDeps = {
  markUploadFailed?: (uploadId: string, errMsg: string) => Promise<void>;
  classify?: (globalSku: string) => Promise<SkuCustomClassification>;
  itemStore?: Pick<ItemStore, "setItemStatus">;
  sagaStore?: Pick<SagaStore, "setStep">;
};

async function defaultMarkUploadFailed(uploadId: string, errMsg: string): Promise<void> {
  await getDb()
    .update(cad_uploads)
    .set({
      status: "failed",
      error_message: errMsg,
      updated_at: new Date(),
    })
    .where(eq(cad_uploads.id, uploadId));
}

/**
 * Marks the upload failed and, for a job-bound custom SKU, moves its item to `cad_failed` and
 * records the saga step. The saga step is only rewritten when the item really transitioned, so a
 * late failure can never overwrite the step of an item that is already finalized or released.
 * Both side effects run even if the first fails; failures are rethrown (AggregateError if both).
 */
export async function handleCadUploadFailure(
  input: { uploadId: string; globalSku: string; errMsg: string },
  deps: CadFailureDeps = {},
): Promise<void> {
  const markUploadFailed = deps.markUploadFailed ?? defaultMarkUploadFailed;
  const classify = deps.classify ?? ((sku: string) => classifyCustomSku(sku));
  const failures: unknown[] = [];

  if (input.uploadId) {
    try {
      await markUploadFailed(input.uploadId, input.errMsg);
    } catch (err) {
      failures.push(err);
    }
  }

  if (input.globalSku) {
    try {
      const classification = await classify(input.globalSku);
      if (classification.type === "custom_job_bound") {
        const itemStore = deps.itemStore ?? createItemStore();
        const sagaStore = deps.sagaStore ?? createSagaStore();
        const result = await itemStore.setItemStatus({
          globalSku: input.globalSku,
          from: ["awaiting_cad", "needs_review", "cad_failed"],
          to: "cad_failed",
        });
        if (result.updated) {
          await sagaStore.setStep(
            PATH_A_SAGA_TYPE,
            classification.opportunityId,
            `cad_failed:${input.errMsg.slice(0, 50)}`,
          );
        }
      }
    } catch (err) {
      failures.push(err);
    }
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "process-cad-upload failure handling failed");
  }
}
