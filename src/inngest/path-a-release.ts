/**
 * Phase 11 Task 7 — Function 2: Stateless Katana Release (M1, M2, M3).
 * Triggered by DB-authorized release request event.
 * Claims saga atomically, publishes recipes behind the fence, creates exactly ONE
 * Katana Sales Order, creates MOs per item, and marks saga completed.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * - NO Katana DELETE anywhere (no delete_so, no delete_mo, no planCompensation).
 * - NO wait primitives (no waitForEvent, no sleep, no sleepUntil).
 * - Zero ghost demand: pre-release custom orders never exist in Katana.
 * - Concurrency serialization via KATANA_TENANT_CONCURRENCY + per-opp lock.
 */
import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { runKatanaStep } from "@/inngest/katana-step";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import {
  CC_MANUFACTURING_LOCATION_ID,
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  ensureKatanaVariantForSku,
  findKatanaSalesOrderByOrderNo,
  KatanaApiError,
  katanaFetch,
  syncBOMToKatana,
} from "@/lib/katana";
import { parseKatanaListPayload, parseMoTreeNode } from "@/lib/katana-mto";
import { getOrderPipelineMode, type OrderPipelineMode } from "@/server/pipeline/mode";
import { getCatalogPublishMode, type CatalogPublishMode } from "@/server/pipeline/catalog-mode";
import { katanaOrderNo } from "@/server/sre/idempotency";
import { getDb } from "@/server/db/client";
import {
  channel_sync,
  custom_build_job_items,
  custom_build_jobs,
  factory_release_gate,
  order_intake,
  sku_mappings,
} from "@/server/db/schema";
import { createReleaseStore, type ReleaseStore } from "@/server/path-a/release-store";
import { createItemStore, type ItemStore } from "@/server/path-a/item-store";
import { createSagaStore, type SagaStore } from "@/server/sre/saga-store";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";
import {
  PATH_A_GHL_SYNC_REQUESTED_EVENT,
  PATH_A_RELEASE_COMPLETED_EVENT,
  PATH_A_RELEASE_TO_PRODUCTION_EVENT,
  pathAGhlSyncEventId,
  pathAReleaseCompletedEventId,
} from "@/server/path-a/events";

export type PathAReleaseDeps = {
  releaseStore?: ReleaseStore;
  itemStore?: ItemStore;
  sagaStore?: SagaStore;
  db?: any;
  getOrderMode?: () => OrderPipelineMode;
  getCatalogMode?: () => CatalogPublishMode;
  findSalesOrder?: typeof findKatanaSalesOrderByOrderNo;
  createSalesOrder?: typeof createKatanaSalesOrder;
  createMos?: typeof createMakeToOrderManufacturingOrders;
  syncBom?: typeof syncBOMToKatana;
  ensureVariant?: typeof ensureKatanaVariantForSku;
  fetchKatana?: typeof katanaFetch;
};

export type PathAReleaseResult = {
  ok: boolean;
  ghlOpportunityId: string;
  orderNo?: string;
  ghlFactoryMode?: string;
  catalogMode?: string;
  dryRun?: boolean;
  itemCount?: number;
  katanaSalesOrderId?: number;
  manufacturingOrderIds?: number[];
  skipped?: boolean;
  reason?: string;
};

export async function runPathAReleaseSaga(params: {
  event: any;
  step: any;
  deps?: PathAReleaseDeps;
}): Promise<PathAReleaseResult> {
  const { event, step, deps = {} } = params;
  const oppId = String(event.data?.ghlOpportunityId ?? "").trim();
  const triggerSource = String(event.data?.triggerSource ?? "unknown");

  if (!oppId) {
    throw new NonRetriableError("Missing ghlOpportunityId in event payload");
  }

  const db = deps.db ?? getDb();
  const releaseStore = deps.releaseStore ?? createReleaseStore(() => db);
  const itemStore = deps.itemStore ?? createItemStore(() => db);
  const sagaStore = deps.sagaStore ?? createSagaStore(() => db);
  const getOrderModeFn = deps.getOrderMode ?? getOrderPipelineMode;
  const getCatalogModeFn = deps.getCatalogMode ?? getCatalogPublishMode;
  const findSalesOrderFn = deps.findSalesOrder ?? findKatanaSalesOrderByOrderNo;
  const createSalesOrderFn = deps.createSalesOrder ?? createKatanaSalesOrder;
  const createMosFn = deps.createMos ?? createMakeToOrderManufacturingOrders;
  const syncBomFn = deps.syncBom ?? syncBOMToKatana;
  const ensureVariantFn = deps.ensureVariant ?? ensureKatanaVariantForSku;
  const fetchKatanaFn = deps.fetchKatana ?? katanaFetch;

  // 1. load-and-authorize
  const auth = await step.run("load-and-authorize", async () => {
    const saga = await releaseStore.getSaga(oppId);
    if (!saga || !saga.release_requested_at) {
      console.warn(
        JSON.stringify({
          tag: "path-a-release-unauthorized-event",
          oppId,
          status: saga?.status,
        }),
      );
      return { outcome: "no_recorded_request" as const };
    }
    if (saga.status === "COMPLETED") {
      return { outcome: "already_completed" as const };
    }
    if (saga.status === "PENDING") {
      return { outcome: "design_not_finalized" as const };
    }
    return { outcome: "proceed" as const };
  });

  if (auth.outcome !== "proceed") {
    return {
      ok: auth.outcome === "already_completed",
      skipped: true,
      reason: auth.outcome,
      ghlOpportunityId: oppId,
    };
  }

  // 2. read-modes
  const modes = await step.run("read-modes", async () => {
    const ghlFactoryMode = getOrderModeFn();
    const catalogMode = getCatalogModeFn();
    return { ghlFactoryMode, catalogMode };
  });

  if (modes.ghlFactoryMode !== "live") {
    await step.run("record-dry-run", async () => {
      const items = await itemStore.listItemsForOpportunity(oppId);
      console.log(
        JSON.stringify({
          tag: "path-a-release-dry-run",
          oppId,
          source: triggerSource,
          itemCount: items.length,
        }),
      );
      await sagaStore.setStep(
        PATH_A_SAGA_TYPE,
        oppId,
        `release_dry_run:${triggerSource}`,
      );
    });
    return {
      ok: true,
      dryRun: true,
      ghlOpportunityId: oppId,
      ghlFactoryMode: modes.ghlFactoryMode,
      catalogMode: modes.catalogMode,
    };
  }

  if (modes.catalogMode !== "live") {
    await step.run("check-catalog-variants", async () => {
      const items = await itemStore.listItemsForOpportunity(oppId);
      for (const item of items) {
        const [row] = await db
          .select({ variantId: sku_mappings.katana_variant_id })
          .from(sku_mappings)
          .where(eq(sku_mappings.global_sku, item.global_sku))
          .limit(1);
        if (!row?.variantId) {
          const errMsg = `release_failed:catalog_mode_log: SKU ${item.global_sku} has no Katana variant and catalog mode is ${modes.catalogMode}`;
          await releaseStore.markSagaManual(
            oppId,
            "catalog_mode_check",
            new Error(errMsg),
          );
          throw new NonRetriableError(errMsg);
        }
      }
    });
  }

  // 3. claim-release
  const claim = await step.run("claim-release", async () => {
    return releaseStore.claimRelease(oppId);
  });

  if (claim.outcome === "no_request" || claim.outcome === "not_ready") {
    return {
      ok: false,
      skipped: true,
      reason: claim.outcome,
      ghlOpportunityId: oppId,
    };
  }
  if (claim.outcome === "already_completed") {
    return {
      ok: true,
      skipped: true,
      reason: "already_completed",
      ghlOpportunityId: oppId,
    };
  }

  // 4. validate-items
  const items = await step.run("validate-items", async () => {
    const list = await itemStore.listItemsForOpportunity(oppId);
    if (list.length === 0) {
      await releaseStore.markSagaManual(
        oppId,
        "validate_items",
        new Error("No custom build items found for opportunity"),
      );
      throw new NonRetriableError(
        `No custom build items found for opportunity ${oppId}`,
      );
    }

    for (const item of list) {
      if (item.status !== "finalized" && item.status !== "released") {
        const msg = `Item ${item.global_sku} is in invalid status: ${item.status}`;
        await releaseStore.markSagaManual(oppId, "validate_items", new Error(msg));
        throw new NonRetriableError(msg);
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        const msg = `Item ${item.global_sku} has non-positive quantity: ${item.quantity}`;
        await releaseStore.markSagaManual(oppId, "validate_items", new Error(msg));
        throw new NonRetriableError(msg);
      }

      // Hash check 3.6.3: ensure item.finalized_dossier_hash equals factory_release_gate.dossier_hash
      const [gate] = await db
        .select({ dossierHash: factory_release_gate.dossier_hash })
        .from(factory_release_gate)
        .where(eq(factory_release_gate.root_sku, item.global_sku))
        .limit(1);

      if (!gate?.dossierHash || gate.dossierHash !== item.finalized_dossier_hash) {
        const msg = `Recipe hash mismatch for ${item.global_sku}: gate=${gate?.dossierHash} item=${item.finalized_dossier_hash}`;
        await releaseStore.markSagaManual(oppId, "recipe_hash_check", new Error(msg));
        throw new NonRetriableError(msg);
      }
    }

    return list.sort((a, b) => a.global_sku.localeCompare(b.global_sku));
  });

  // 5. publish-recipe-<sku> (per item)
  for (const item of items) {
    await runKatanaStep(step, `publish-recipe-${item.global_sku}`, async () => {
      if (item.status === "released") {
        return { skipped: true };
      }

      await ensureVariantFn(item.global_sku);

      const [existingSync] = await db
        .select()
        .from(channel_sync)
        .where(
          and(
            eq(channel_sync.global_sku, item.global_sku),
            eq(channel_sync.channel, "katana"),
          ),
        )
        .limit(1);

      if (
        existingSync?.status === "success" &&
        existingSync.payload_hash === item.finalized_dossier_hash
      ) {
        return { ok: true, idempotent: true };
      }

      const syncResult = await syncBomFn(item.global_sku, {
        fromAirlock: true,
        idempotencyKey: `factory-bom:${item.global_sku}:${item.finalized_dossier_hash}`,
      });

      if (!syncResult.ok && !syncResult.dryRun) {
        throw new Error(
          syncResult.error || `Failed to sync recipe for ${item.global_sku}`,
        );
      }
      return syncResult;
    });
  }

  const variantIdsBySku = await step.run("verify-variants", async () => {
    const map: Record<string, number> = {};
    for (const item of items) {
      const [row] = await db
        .select({ variantId: sku_mappings.katana_variant_id })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, item.global_sku))
        .limit(1);
      if (!row?.variantId || row.variantId <= 0) {
        const msg = `Missing Katana variant for ${item.global_sku}`;
        await releaseStore.markSagaManual(oppId, "verify_variants", new Error(msg));
        throw new NonRetriableError(msg);
      }
      map[item.global_sku] = row.variantId;
    }
    return map;
  });

  // 6. ensure-katana-sales-order
  const soInfo = await runKatanaStep(
    step,
    "ensure-katana-sales-order",
    async () => {
      const orderNo = katanaOrderNo("path_a", oppId);
      const existing = await findSalesOrderFn(orderNo);

      if (existing) {
        const addInfo = String(existing.additional_info ?? "");
        const expectedTag = `path_a_saga=${oppId}`;
        if (!addInfo.includes(expectedTag)) {
          const msg = `Order ${orderNo} exists in Katana but lacks provenance tag ${expectedTag}`;
          await releaseStore.markSagaManual(
            oppId,
            "sales_order_provenance",
            new Error(msg),
          );
          throw new NonRetriableError(msg);
        }

        const existingRows = Array.isArray(existing.sales_order_rows)
          ? existing.sales_order_rows
          : [];
        const existingVariantIds = new Set(
          existingRows.map((r: any) => Number(r.variant_id)),
        );
        for (const item of items) {
          const expectedVId = variantIdsBySku[item.global_sku];
          if (!existingVariantIds.has(expectedVId)) {
            const msg = `Order ${orderNo} row variants do not match expected items`;
            await releaseStore.markSagaManual(
              oppId,
              "sales_order_provenance",
              new Error(msg),
            );
            throw new NonRetriableError(msg);
          }
        }

        const rowsMap: Record<string, number> = {};
        for (const item of items) {
          const vId = variantIdsBySku[item.global_sku];
          const matchRow = existingRows.find(
            (r: any) => Number(r.variant_id) === vId,
          );
          if (matchRow?.id) {
            rowsMap[item.global_sku] = Number(matchRow.id);
          }
        }

        return {
          salesOrderId: Number(existing.id),
          orderNo,
          rowsMap,
        };
      }

      const [intake] = await db
        .select({
          contactName: order_intake.contact_name,
          contactEmail: order_intake.contact_email,
        })
        .from(order_intake)
        .where(eq(order_intake.ghl_opportunity_id, oppId))
        .limit(1);

      const customerName = intake?.contactName?.trim() || `GHL ${oppId}`;
      const customerEmail = intake?.contactEmail?.trim() || undefined;

      const created = await createSalesOrderFn({
        orderNo,
        locationId: CC_MANUFACTURING_LOCATION_ID,
        idempotencyKey: orderNo,
        currency: "USD",
        source: "ghl",
        externalId: oppId,
        additionalInfo: `path_a_saga=${oppId}`,
        customer: {
          name: customerName,
          email: customerEmail,
        },
        salesOrderRows: items.map((item) => ({
          sku: item.global_sku,
          quantity: Number(item.quantity),
          pricePerUnit: 0,
        })),
      });

      const returnedRows = created.salesOrderRows ?? [];
      const rowsMap: Record<string, number> = {};
      for (const item of items) {
        const vId = variantIdsBySku[item.global_sku];
        const matchRow =
          returnedRows.find((r: any) => Number(r.variant_id) === vId) ??
          returnedRows.find((r: any) => r.sku === item.global_sku);
        const rowId = matchRow?.id
          ? Number(matchRow.id)
          : created.salesOrderRowIds[items.indexOf(item)];
        rowsMap[item.global_sku] = rowId;
      }

      const now = new Date();
      await db
        .update(custom_build_jobs)
        .set({
          katana_sales_order_id: String(created.salesOrderId),
          katana_order_no: orderNo,
          updated_at: now,
        })
        .where(eq(custom_build_jobs.ghl_opportunity_id, oppId));

      for (const item of items) {
        const rId = rowsMap[item.global_sku];
        if (rId) {
          await db
            .update(custom_build_job_items)
            .set({
              katana_sales_order_row_id: rId,
              updated_at: now,
            })
            .where(eq(custom_build_job_items.id, item.id));
        }
      }

      return {
        salesOrderId: created.salesOrderId,
        orderNo,
        rowsMap,
      };
    },
  );

  // 7. ensure-mo-<sku> and stamp-mo-<sku> (per item)
  const moIds: number[] = [];
  for (const item of items) {
    const moResult = await runKatanaStep(
      step,
      `ensure-mo-${item.global_sku}`,
      async () => {
        const rowId = soInfo.rowsMap[item.global_sku];
        if (!rowId) {
          throw new NonRetriableError(
            `No sales order row id found for ${item.global_sku}`,
          );
        }

        const { data: moListData } = await fetchKatanaFn(
          `/manufacturing_orders?sales_order_id=${soInfo.salesOrderId}&limit=50`,
        );
        let existingMoId: number | null = null;
        for (const record of parseKatanaListPayload(moListData)) {
          const node = parseMoTreeNode(record);
          if (node?.sales_order_row_id === rowId && node.id) {
            existingMoId = node.id;
            break;
          }
        }

        let finalMoId: number;
        if (existingMoId) {
          finalMoId = existingMoId;
        } else {
          const createdMos = await createMosFn([rowId], {
            createSubassemblies: false,
          });
          const matchCreated = createdMos.find(
            (m) => m.salesOrderRowId === rowId,
          );
          if (!matchCreated) {
            throw new Error(`Failed to create MO for row ${rowId}`);
          }
          finalMoId = matchCreated.manufacturingOrderId;
        }

        const { createCutCardToken } = await import(
          "@/server/factory-bom/cut-card-token"
        );
        const token = createCutCardToken({
          jobId: item.job_id,
          globalSku: item.global_sku,
        });
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL || "https://app.ccpatio.com";
        const cutCardUrl = `${appUrl}/factory/cut-cards/${token}`;

        await fetchKatanaFn(`/manufacturing_orders/${finalMoId}`, {
          method: "PATCH",
          body: {
            additional_info: `custom_build=1\nCut card: ${cutCardUrl}`,
          },
        });

        const now = new Date();
        await db
          .update(custom_build_job_items)
          .set({
            katana_mo_id: finalMoId,
            status: "released",
            released_at: now,
            updated_at: now,
          })
          .where(eq(custom_build_job_items.id, item.id));

        return { moId: finalMoId };
      },
    );
    moIds.push(moResult.moId);
  }

  await step.run("persist-job-mo-ids", async () => {
    const now = new Date();
    await db
      .update(custom_build_jobs)
      .set({
        katana_mo_ids: moIds,
        updated_at: now,
      })
      .where(eq(custom_build_jobs.ghl_opportunity_id, oppId));
  });

  // 8. finalize-saga
  await step.run("finalize-saga", async () => {
    await releaseStore.markSagaCompleted(oppId);
  });

  await step.sendEvent("send-release-completed-event", {
    id: pathAReleaseCompletedEventId(oppId),
    name: PATH_A_RELEASE_COMPLETED_EVENT,
    data: {
      ghlOpportunityId: oppId,
      salesOrderId: soInfo.salesOrderId,
      orderNo: soInfo.orderNo,
    },
  });

  await step.sendEvent("send-ghl-sync-event", {
    id: pathAGhlSyncEventId(oppId, 1),
    name: PATH_A_GHL_SYNC_REQUESTED_EVENT,
    data: {
      ghlOpportunityId: oppId,
    },
  });

  return {
    ok: true,
    ghlOpportunityId: oppId,
    orderNo: soInfo.orderNo,
    ghlFactoryMode: modes.ghlFactoryMode,
    catalogMode: modes.catalogMode,
    dryRun: false,
    itemCount: items.length,
    katanaSalesOrderId: soInfo.salesOrderId,
    manufacturingOrderIds: moIds,
  };
}

export const pathAReleaseToProduction = inngest.createFunction(
  {
    id: "path-a-release-to-production",
    name: "Path A Release to Production (Katana)",
    triggers: [{ event: PATH_A_RELEASE_TO_PRODUCTION_EVENT }],
    concurrency: [
      KATANA_TENANT_CONCURRENCY,
      { limit: 1, key: "event.data.ghlOpportunityId" },
    ],
    retries: 3,
  },
  async ({ event, step }) => {
    return runPathAReleaseSaga({ event, step });
  },
);
