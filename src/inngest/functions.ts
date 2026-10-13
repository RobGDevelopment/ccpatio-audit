import { inngest } from "@/inngest/client";
import { runKatanaStep } from "./katana-step";
import { suggestProductSeo } from "./seo-suggest";
import {
  ORDER_APPROVED_EVENT,
  runApprovedFactoryOrder,
} from "@/server/ghl/push-factory-order";
import {
  autoReleaseExpiredHolds,
  sendHoldExpirationWarnings,
} from "@/server/inngest/inventory-holds";
import { executeReleaseCustomBuild } from "@/server/factory-bom/release-custom-build";
import { sweepExpiredInventoryHolds } from "@/server/stock/sweep-expired-holds";
import {
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  KatanaApiError,
  mapGhlOpportunityToKatanaSalesOrder,
} from "@/lib/katana";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { GHL_OPPORTUNITY_WON_EVENT, ghlOpportunityIdempotencyKey } from "@/server/ghl/ingress";
import { syncCloverPayment } from "./clover-sync";
import { globalDlqHandler } from "./dlq";
import { processWooCommerceOrder } from "./woo-order";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import {
  ghlOpportunitySyncSchema,
  type GhlOpportunitySync,
} from "@/server/ghl/ingress.schema";
import {
  canMutateKatanaOrders,
  getOrderPipelineMode,
  pipelineModeLabel,
  type OrderPipelineMode,
} from "@/server/pipeline/mode";
import {
  logIncomingWebhook,
  updateIncomingWebhookStatus,
} from "@/server/webhooks/incoming-log";

export type { GhlOpportunitySync };
export { ghlOpportunitySyncSchema } from "@/server/ghl/ingress.schema";

function ghlEventOpportunityPayload(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  return record.opportunity ?? data;
}

function formatKatanaFailure(error: unknown): string {
  if (error instanceof KatanaApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Katana sales order creation failed";
}

function firstSkuFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const lineItems = (payload as { line_items?: unknown }).line_items;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return undefined;
  const sku = (lineItems[0] as { sku?: unknown })?.sku;
  return typeof sku === "string" && sku.trim() ? sku.trim() : undefined;
}

async function alertPipelineFailure(input: {
  source: "ghl" | "woocommerce";
  externalId: string;
  sku?: string;
  message: string;
  reason:
    | "sku_not_in_dictionary"
    | "sku_not_in_katana"
    | "validation_failed"
    | "katana_rejected"
    | "missing_line_items"
    | "unknown";
  rawPayload?: unknown;
}): Promise<void> {
  await sendOhCrapAlert({
    ...input,
    resolutionPath: input.sku
      ? `/admin/dictionary?sku=${encodeURIComponent(input.sku)}`
      : `/admin/dictionary?source=${input.source}&externalId=${encodeURIComponent(input.externalId)}`,
  });
}

// The Woo paid-order saga lives in ./woo-order (Phase 10, roadmap step 6). Re-exported so existing
// imports keep working. It is REGISTERED below; it has no alerting onFailure (global DLQ alerts).
export { processWooCommerceOrder };

export const syncGhlOpportunity = inngest.createFunction(
  {
    id: "sync-ghl-opportunity",
    name: "Process GHL Opportunity Won",
    triggers: [{ event: GHL_OPPORTUNITY_WON_EVENT }],
    onFailure: async ({ error, event }) => {
      const data = ghlEventOpportunityPayload(event.data.event?.data) as {
        id?: unknown;
        line_items?: unknown;
        opportunity?: { id?: unknown; line_items?: unknown };
      } | undefined;
      await alertPipelineFailure({
        reason: "unknown",
        source: "ghl",
        externalId: String(data?.id ?? data?.opportunity?.id ?? "unknown"),
        sku: firstSkuFromPayload(data),
        message: error.message,
        rawPayload: event.data,
      });
    },
  },
  async ({ event, step }) => {
    const mode: OrderPipelineMode = getOrderPipelineMode();
    const opportunityPayload = ghlEventOpportunityPayload(event.data);
    const parsed = ghlOpportunitySyncSchema.safeParse(opportunityPayload);
    const opportunityId = parsed.success
      ? parsed.data.id
      : String(
          (opportunityPayload as { id?: unknown })?.id ??
            (event.data as { opportunityId?: unknown })?.opportunityId ??
            "unknown",
        );
    const idempotencyKey = ghlOpportunityIdempotencyKey(opportunityId);

    if (!parsed.success) {
      await step.run("log-invalid-ghl-opportunity", async () => {
        await logIncomingWebhook({
          source: "ghl",
          eventName: event.name,
          idempotencyKey: `${idempotencyKey}-worker-invalid`,
          payload: event.data,
          status: "failed",
          errorMessage: parsed.error.message,
        });
        await alertPipelineFailure({
          reason: "validation_failed",
          source: "ghl",
          externalId: opportunityId,
          message: parsed.error.message,
          rawPayload: event.data,
        });
      });
      return { ok: false, reason: "validation_failed", pipelineMode: mode };
    }

    const salesOrderPayload = mapGhlOpportunityToKatanaSalesOrder(parsed.data);
    if (!salesOrderPayload) {
      await step.run("mark-ghl-opportunity-processed-no-order", async () => {
        await updateIncomingWebhookStatus(
          idempotencyKey,
          "processed",
          "Skipped Katana sales order — opportunity not Won or missing line items.",
        );
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: false,
        reason: "not_won_or_no_line_items",
        pipelineMode: mode,
      };
    }

    if (!canMutateKatanaOrders(mode)) {
      await step.run("mark-ghl-opportunity-log-only", async () => {
        await updateIncomingWebhookStatus(
          idempotencyKey,
          "processed",
          `ORDER_PIPELINE_MODE=${mode} — Katana SO/MTO skipped (${pipelineModeLabel(mode)}). Would create SO for ${salesOrderPayload.salesOrderRows.length} line(s).`,
        );
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: false,
        dryRun: true,
        pipelineMode: mode,
        intendedLineCount: salesOrderPayload.salesOrderRows.length,
      };
    }

    try {
      const salesOrder = await step.run("create-katana-sales-order", async () =>
        createKatanaSalesOrder(salesOrderPayload),
      );

      const mtoOrders = await step.run("create-katana-mto-orders", async () => {
        if (salesOrder.salesOrderRowIds.length === 0) {
          throw new KatanaApiError(
            "Sales order created but no sales_order_row ids returned for MTO.",
            { status: 422 },
          );
        }
        return createMakeToOrderManufacturingOrders(salesOrder.salesOrderRowIds);
      });

      await step.run("mark-ghl-opportunity-processed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "processed");
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: true,
        katanaSalesOrderId: salesOrder.salesOrderId,
        katanaOrderNo: salesOrder.orderNo,
        manufacturingOrderIds: mtoOrders.map((mo) => mo.manufacturingOrderId),
        pipelineMode: mode,
      };
    } catch (error: unknown) {
      const message = formatKatanaFailure(error);
      const sku = salesOrderPayload.salesOrderRows[0]?.sku;
      await step.run("mark-ghl-opportunity-failed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "failed", message);
        await alertPipelineFailure({
          reason: "katana_rejected",
          source: "ghl",
          externalId: parsed.data.id,
          sku,
          message,
          rawPayload: parsed.data,
        });
      });
      throw error instanceof Error ? error : new Error(message);
    }
  },
);

export const sendStaffFeedbackDigest = inngest.createFunction(
  { 
    id: "send-staff-feedback-digest", 
    name: "Send Twice-Daily Staff Feedback Digest",
    triggers: [{ cron: "0 9,17 * * *" }]
  },
  async ({ step }: any) => {
    const reportHTML = await step.run("fetch-and-compile-notes", async () => {
      const { getDb } = await import("@/server/db/client");
      const { staff_notes } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      
      const db = getDb();
      const pendingNotes = await db.query.staff_notes.findMany({
        where: eq(staff_notes.status, "pending"),
        orderBy: (notes: any, { desc }: any) => [desc(notes.created_at)],
      });

      if (pendingNotes.length === 0) {
        return null;
      }

      const listItems = pendingNotes.map((n: any) => 
        `<li><strong>${n.operator_email}</strong> [${n.panel_location}] (SKU: ${n.global_sku || 'N/A'}): ${n.note}</li>`
      ).join("");

      return `
        <h2>Daily Staff Feedback Digest</h2>
        <p>You have ${pendingNotes.length} pending requests from the staff:</p>
        <ul>${listItems}</ul>
      `;
    });

    if (reportHTML) {
      await step.run("send-digest-email", async () => {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");
        
        await resend.emails.send({
          from: "CC Patio Admin <admin@ccpatio.com>",
          to: "rjg.cal@gmail.com",
          subject: "📋 CC Patio PIM: Staff Feedback Digest",
          html: reportHTML,
        });
      });
    }

    return { ok: true, sent: !!reportHTML };
  }
);

export const archiveKatanaVariant = inngest.createFunction(
  { 
    id: "archive-katana-variant", 
    name: "Archive Katana Variant on Discontinue",
    triggers: [{ event: "katana/variant.archive" }],
    concurrency: KATANA_TENANT_CONCURRENCY,
  },
  async ({ event, step }: any) => {
    await runKatanaStep(step, "archive-variant-in-katana", async () => {
      const { getDb } = await import("@/server/db/client");
      const { sku_mappings } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      
      const db = getDb();
      const mapping = await db.query.sku_mappings.findFirst({
        where: eq(sku_mappings.global_sku, event.data.globalSku),
      });

      if (mapping && mapping.katana_variant_id) {
        const { archiveKatanaVariant: archiveApiCall } = await import("@/lib/katana/client");
        try {
          await archiveApiCall(mapping.katana_variant_id);
        } catch (e) {
          console.error("[Katana Archive] Failed", e);
        }
      }
    });

    return { ok: true, globalSku: event.data.globalSku };
  }
);

/**
 * Phase 4 — durable catalog fan-out saga (Katana / Woo / Clover).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md §12.
 */
export const publishApprovedProduct = inngest.createFunction(
  {
    id: "publish-approved-product",
    name: "Publish Approved Product",
    triggers: [{ event: "product.approved" }],
    // Per-SKU serialization AND the single-tenant Katana limit (Inngest allows 2 entries).
    concurrency: [
      {
        limit: 1,
        key: "event.data.globalSku",
      },
      KATANA_TENANT_CONCURRENCY,
    ],
    // No onFailure alert: the global DLQ (src/inngest/dlq.ts + dlq-context.ts) is the single
    // alert authority and carries the /admin/quarantine?sku= link. A second alert here would
    // double every exhausted run.
  },
  async ({ event, step }) => {
    const globalSku = String(event.data.globalSku ?? "").trim().toUpperCase();
    const exportId = String(event.data.exportId ?? "");

    if (!globalSku) {
      const { NonRetriableError } = await import("inngest");
      throw new NonRetriableError(
        "product.approved missing event.data.globalSku",
      );
    }

    const graph = await step.run("load-hub-state", async () => {
      const { loadHubProductGraph } = await import(
        "@/server/mdm/load-hub-product-graph"
      );
      return loadHubProductGraph(globalSku);
    });

    const staged = await step.run("validate-catalog-graph", async () => {
      const { NonRetriableError } = await import("inngest");
      const {
        KatanaCatalogPublishError,
        stageKatanaCatalogGraph,
      } = await import("@/mappers/katana-catalog-guard");
      try {
        return stageKatanaCatalogGraph(graph);
      } catch (error) {
        if (error instanceof KatanaCatalogPublishError) {
          throw new NonRetriableError(error.message, { cause: error });
        }
        throw error;
      }
    });

    const [katana, woocommerce, clover] = await Promise.all([
      runKatanaStep(step, "publish-katana", async () => {
        const { publishToKatana } = await import(
          "@/server/mdm/publish-channels"
        );
        return publishToKatana(staged.graph);
      }),
      step.run("publish-woocommerce", async () => {
        const { publishToWooCommerce } = await import(
          "@/server/mdm/publish-channels"
        );
        return publishToWooCommerce(graph);
      }),
      step.run("publish-clover", async () => {
        const { publishToClover } = await import(
          "@/server/mdm/publish-channels"
        );
        return publishToClover(graph);
      }),
    ]);

    return {
      ok: true,
      globalSku,
      exportId,
      strippedColorwaySkus: staged.strippedColorwaySkus,
      warnings: staged.warnings,
      channels: { katana, woocommerce, clover },
    };
  },
);

/**
 * Phase 5 — daily authenticated pings for Katana / Woo / Clover tokens.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md §13.
 */
export const systemHealthPing = inngest.createFunction(
  {
    id: "system-health-ping",
    name: "system.health.ping",
    triggers: [{ cron: "0 6 * * *" }],
    // Pings Katana directly (raw fetch, outside katanaFetch): serialize with the tenant limit.
    concurrency: KATANA_TENANT_CONCURRENCY,
  },
  async ({ step }) => {
    return step.run("ping-catalog-spokes", async () => {
      const { runSpokeTokenHealthCheck } = await import(
        "@/server/mdm/token-health"
      );
      return runSpokeTokenHealthCheck();
    });
  },
);

/**
 * Factory BOM CAD upload → draft BOM + secondary estimates (never live hub).
 * Binding: docs/CAD_UPLOAD_PIPELINE_PLAN.md
 */
export const processCadUpload = inngest.createFunction(
  {
    id: "process-cad-upload",
    name: "Process CAD Upload",
    triggers: [{ event: "cad/model.uploaded" }],
    concurrency: {
      limit: 1,
      key: "event.data.globalSku",
    },
    // Non-alert side effect only. The ALERT comes from the global DLQ (single authority,
    // carries the /admin/factory-bom?sku= link via dlq-context.ts).
    onFailure: async ({ event }) => {
      const original = event.data.event;
      const uploadId = String(
        (original?.data as { uploadId?: unknown } | undefined)?.uploadId ?? "",
      );
      const globalSku = String(
        (original?.data as { globalSku?: unknown } | undefined)?.globalSku ?? "",
      ).trim().toUpperCase();
      const errMsg =
        typeof event.data.error?.message === "string"
          ? event.data.error.message
          : "process-cad-upload exhausted retries";

      if (uploadId) {
        try {
          const { getDb } = await import("@/server/db/client");
          const { cad_uploads } = await import("@/server/db/schema");
          const { eq } = await import("drizzle-orm");
          await getDb()
            .update(cad_uploads)
            .set({
              status: "failed",
              error_message: errMsg,
              updated_at: new Date(),
            })
            .where(eq(cad_uploads.id, uploadId));
        } catch {
          /* best-effort */
        }
      }

      if (globalSku) {
        try {
          const { classifyCustomSku } = await import("@/server/path-a/katana-fence");
          const classification = await classifyCustomSku(globalSku);
          if (classification.type === "custom_job_bound") {
            const { createItemStore } = await import("@/server/path-a/item-store");
            const { createSagaStore } = await import("@/server/sre/saga-store");
            const { PATH_A_SAGA_TYPE } = await import("@/server/path-a/saga-state");
            const itemStore = createItemStore();
            const sagaStore = createSagaStore();
            await itemStore.setItemStatus({
              globalSku,
              from: ["awaiting_cad", "needs_review", "cad_failed"],
              to: "cad_failed",
            });
            await sagaStore.setStep(
              PATH_A_SAGA_TYPE,
              classification.opportunityId,
              `cad_failed:${errMsg.slice(0, 50)}`,
            );
          }
        } catch {
          /* best-effort */
        }
      }
    },
  },
  async ({ event, step }) => {
    const data = {
      uploadId: String(event.data.uploadId ?? ""),
      globalSku: String(event.data.globalSku ?? "")
        .trim()
        .toUpperCase(),
      storagePath: String(event.data.storagePath ?? ""),
      ext: String(event.data.ext ?? "").toLowerCase() as "dae" | "skp" | "glb" | "blend",
      sha256:
        typeof event.data.sha256 === "string" ? event.data.sha256 : undefined,
      operatorEmail: String(event.data.operatorEmail ?? ""),
      replaceImage: Boolean(event.data.replaceImage),
    };

    if (!data.uploadId || !data.globalSku || !data.storagePath) {
      const { NonRetriableError } = await import("inngest");
      throw new NonRetriableError("cad/model.uploaded missing required fields");
    }

    if (data.ext !== "glb" && data.ext !== "dae" && data.ext !== "skp" && data.ext !== "blend") {
      const { NonRetriableError } = await import("inngest");
      throw new NonRetriableError(`Invalid CAD extension: ${data.ext}`);
    }

    let effectiveStoragePath = data.storagePath;
    let effectiveExt = data.ext;

    if (data.ext === "blend") {
      const { runCadConvertHandoff } = await import("@/inngest/cad-handoff");
      const handoffResult = await runCadConvertHandoff({ step, data });
      if (!handoffResult.ok) {
        const { NonRetriableError } = await import("inngest");
        throw new NonRetriableError(handoffResult.error);
      }
      effectiveStoragePath = handoffResult.glbStoragePath;
      effectiveExt = "glb";
    }

    const jobResult = await step.run("process-cad-bytes", async () => {
      const { processCadUploadJob } = await import(
        "@/lib/cad-upload/process-job"
      );
      return processCadUploadJob(
        {
          ...data,
          storagePath: effectiveStoragePath,
          ext: effectiveExt,
        },
        { allowSyncConvert: false },
      );
    });

    if (!jobResult.ok) {
      const { NonRetriableError } = await import("inngest");
      throw new NonRetriableError(jobResult.error);
    }

    const { classifyCustomSku } = await import("@/server/path-a/katana-fence");
    const classification = await classifyCustomSku(data.globalSku);
    if (classification.type === "custom_job_bound") {
      await step.run("post-extract-advance", async () => {
        const { createItemStore } = await import("@/server/path-a/item-store");
        const { createReleaseStore } = await import("@/server/path-a/release-store");
        const itemStore = createItemStore();
        const releaseStore = createReleaseStore();

        await itemStore.setItemStatus({
          globalSku: data.globalSku,
          from: ["awaiting_cad", "needs_review"],
          to: "needs_review",
        });

        await releaseStore.advanceSaga(classification.opportunityId);
      });
    }

    return jobResult;
  },
);

export const releaseCustomJob = inngest.createFunction(
  {
    id: "release-custom-job",
    name: "Release Custom Job to Katana",
    triggers: [{ event: "factory.custom_job.released" }],
    concurrency: KATANA_TENANT_CONCURRENCY,
    retries: 3,
  },
  async ({ event, step }) => {
    const data = event.data as { globalSku?: string };
    const globalSku = data.globalSku;
    if (!globalSku) {
      throw new Error("Missing globalSku in factory.custom_job.released payload");
    }
    return runKatanaStep(step, "release-custom-job", () => executeReleaseCustomBuild(globalSku));
  },
);

export const pushApprovedFactoryOrder = inngest.createFunction(
  {
    id: "push-approved-factory-order",
    name: "Push approved GHL factory order to Katana",
    triggers: [{ event: ORDER_APPROVED_EVENT }],
    concurrency: KATANA_TENANT_CONCURRENCY,
    retries: 3,
  },
  async ({ event, step }) => {
    const data = event.data as { orderIntakeId?: string; version?: number };
    if (!data.orderIntakeId || !Number.isFinite(data.version)) {
      const { NonRetriableError } = await import("inngest");
      throw new NonRetriableError("order.approved requires orderIntakeId and version.");
    }
    return runApprovedFactoryOrder({
      orderIntakeId: data.orderIntakeId,
      version: data.version as number,
      step: {
        run: (id, fn) => step.run(id, fn),
      },
    });
  },
);

/**
 * Served by `/api/inngest`. The Woo paid-order saga (roadmap step 6) is registered; it is
 * dry-run unless ORDER_PIPELINE_MODE=live. The legacy GHL Won auto-push stays unregistered.
 * `order.approved` is the only GHL factory writer (§2.4).
 */
export const inngestFunctions = [
  sendStaffFeedbackDigest,
  archiveKatanaVariant,
  publishApprovedProduct,
  systemHealthPing,
  processCadUpload,
  releaseCustomJob,
  pushApprovedFactoryOrder,
  sweepExpiredInventoryHolds,
  sendHoldExpirationWarnings,
  autoReleaseExpiredHolds,
  syncCloverPayment,
  processWooCommerceOrder,
  globalDlqHandler,
];

/**
 * Legacy GHL Won order pipeline — defined but NOT registered. Do not add this to
 * `inngestFunctions` or `serve()`. `order.approved` owns GHL factory orders.
 */
export const unregisteredTransactionalFunctions = [syncGhlOpportunity] as const;

/**
 * OpenAI SEO assistant — defined but NOT registered. Catalog publish must not
 * invoke it. Do not add these to `inngestFunctions` or `serve()`.
 */
export const unregisteredSeoFunctions = [suggestProductSeo] as const;
