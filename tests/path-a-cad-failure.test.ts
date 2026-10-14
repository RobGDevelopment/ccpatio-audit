/**
 * Phase 11 remediation — QCA m1: `processCadUpload.onFailure` swallowed both side effects in empty
 * `catch {}` blocks. The side effects now live in `handleCadUploadFailure`, which runs BOTH, never
 * hides a failure, and never rewrites a saga step for an item it did not actually fail.
 */
import { describe, expect, it, vi } from "vitest";
import { handleCadUploadFailure } from "@/inngest/cad-failure";

function deps(over: Record<string, unknown> = {}) {
  const itemStore = { setItemStatus: vi.fn(async () => ({ updated: true })) };
  const sagaStore = { setStep: vi.fn(async () => undefined) };
  const markUploadFailed = vi.fn(async () => undefined);
  const classify = vi.fn(async () => ({
    type: "custom_job_bound" as const,
    jobId: "job-1",
    opportunityId: "opp-1",
  }));
  return {
    itemStore,
    sagaStore,
    markUploadFailed,
    classify,
    all: { itemStore, sagaStore, markUploadFailed, classify, ...over } as never,
  };
}

const input = { uploadId: "upl-1", globalSku: "JOB-A", errMsg: "retries exhausted" };

describe("handleCadUploadFailure (m1)", () => {
  it("marks the upload failed and the job-bound item cad_failed + saga step", async () => {
    const d = deps();
    await handleCadUploadFailure(input, d.all);
    expect(d.markUploadFailed).toHaveBeenCalledWith("upl-1", "retries exhausted");
    expect(d.itemStore.setItemStatus).toHaveBeenCalledWith({
      globalSku: "JOB-A",
      from: ["awaiting_cad", "needs_review", "cad_failed"],
      to: "cad_failed",
    });
    expect(d.sagaStore.setStep).toHaveBeenCalledWith("path_a_cad", "opp-1", "cad_failed:retries exhausted");
  });

  it("does NOT rewrite the saga step when the item was not in a failable state (e.g. already finalized/released)", async () => {
    const d = deps();
    d.itemStore.setItemStatus.mockResolvedValueOnce({ updated: false });
    await handleCadUploadFailure(input, d.all);
    expect(d.sagaStore.setStep).not.toHaveBeenCalled();
  });

  it("a failing upload update is NOT swallowed, and the Path A side effect still runs", async () => {
    const d = deps();
    d.markUploadFailed.mockRejectedValueOnce(new Error("db down: upload"));
    await expect(handleCadUploadFailure(input, d.all)).rejects.toThrow(/db down: upload/);
    expect(d.itemStore.setItemStatus).toHaveBeenCalledTimes(1);
  });

  it("a failing Path A update is NOT swallowed, and the upload update still ran", async () => {
    const d = deps();
    d.itemStore.setItemStatus.mockRejectedValueOnce(new Error("db down: item"));
    await expect(handleCadUploadFailure(input, d.all)).rejects.toThrow(/db down: item/);
    expect(d.markUploadFailed).toHaveBeenCalledTimes(1);
  });

  it("surfaces BOTH failures when both side effects fail", async () => {
    const d = deps();
    d.markUploadFailed.mockRejectedValueOnce(new Error("db down: upload"));
    d.itemStore.setItemStatus.mockRejectedValueOnce(new Error("db down: item"));
    const err = (await handleCadUploadFailure(input, d.all).catch((e) => e)) as AggregateError;
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors.map((e: Error) => e.message)).toEqual(["db down: upload", "db down: item"]);
  });

  it("skips Path A for catalog SKUs and skips the upload update when there is no upload id", async () => {
    const d = deps({ classify: vi.fn(async () => ({ type: "not_custom" as const })) });
    await handleCadUploadFailure({ uploadId: "", globalSku: "FIN-1", errMsg: "x" }, d.all);
    expect(d.markUploadFailed).not.toHaveBeenCalled();
    expect(d.itemStore.setItemStatus).not.toHaveBeenCalled();
  });
});

describe("D5: CAD intake post-extract-advance throws NonRetriableError on locked saga", () => {
  it("converts SagaDesignLockedError to NonRetriableError and updates item status", async () => {
    const { advanceSagaAfterExtract } = await import("@/inngest/cad-handoff");
    const { SagaDesignLockedError } = await import("@/server/path-a/release-store");
    const { NonRetriableError } = await import("inngest");
    const lockedErr = new SagaDesignLockedError("opp-locked", "IN_PROGRESS");

    const itemStore = {
      setItemStatus: vi.fn(async () => ({ updated: true, item: null })),
    };
    const releaseStore = {
      advanceSaga: vi.fn(async () => {
        throw lockedErr;
      }),
    };

    await expect(
      advanceSagaAfterExtract({
        globalSku: "JOB-TEST-1",
        opportunityId: "opp-locked",
        itemStore: itemStore as never,
        releaseStore: releaseStore as never,
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);

    expect(itemStore.setItemStatus).toHaveBeenCalledWith({
      globalSku: "JOB-TEST-1",
      from: ["awaiting_cad", "needs_review"],
      to: "needs_review",
    });
    expect(releaseStore.advanceSaga).toHaveBeenCalledWith("opp-locked");
  });

  it("leaves a plain Error as a plain Error (not converted to NonRetriableError)", async () => {
    const { advanceSagaAfterExtract } = await import("@/inngest/cad-handoff");
    const { NonRetriableError } = await import("inngest");
    const plainErr = new Error("transient db timeout");

    const itemStore = {
      setItemStatus: vi.fn(async () => ({ updated: true, item: null })),
    };
    const releaseStore = {
      advanceSaga: vi.fn(async () => {
        throw plainErr;
      }),
    };

    const call = advanceSagaAfterExtract({
      globalSku: "JOB-TEST-1",
      opportunityId: "opp-transient",
      itemStore: itemStore as never,
      releaseStore: releaseStore as never,
    });

    await expect(call).rejects.toThrow("transient db timeout");
    await expect(call).rejects.not.toBeInstanceOf(NonRetriableError);
  });
});
