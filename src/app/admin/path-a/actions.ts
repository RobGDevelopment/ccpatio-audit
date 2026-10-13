"use server";

import { revalidatePath } from "next/cache";
import { getPimSession } from "@/lib/pim-audit";

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
  const oppId = classification.opportunityId;

  const { createItemStore } = await import("@/server/path-a/item-store");
  const { createReleaseStore } = await import("@/server/path-a/release-store");
  const itemStore = createItemStore();
  const releaseStore = createReleaseStore();

  const itemResult = await itemStore.setItemStatus({
    globalSku: sku,
    from: ["needs_review", "finalized"],
    to: "finalized",
    finalizedDossierHash: dossierHash,
    finalizedBy: session.email,
    finalizedAt: new Date(),
    quantity: qty,
  });

  if (!itemResult.updated) {
    return { ok: false, error: "Failed to transition item to finalized" };
  }

  const advanceRes = await releaseStore.advanceSaga(oppId);

  try {
    revalidatePath("/admin/path-a");
  } catch {
    /* outside request context */
  }

  const { inngest } = await import("@/inngest/client");
  const {
    PATH_A_DESIGN_FINALIZED_EVENT,
    PATH_A_RELEASE_TO_PRODUCTION_EVENT,
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
      const attempt = await releaseStore.bumpReleaseAttempt(oppId);
      await inngest.send({
        id: pathAReleaseEventId(oppId, { replay: attempt }),
        name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
        data: {
          ghlOpportunityId: oppId,
          attempt,
          triggerSource: "early_deposit_replay",
        },
      });
    }
  } catch (err) {
    console.error("[finalizeDesignAction] Inngest send error:", err);
    return { ok: false, committed: true, retryable: true, dossierHash };
  }

  return { ok: true, dossierHash };
}
