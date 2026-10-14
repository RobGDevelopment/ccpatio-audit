/**
 * Phase 11 Task 7 — Function 2: Stateless Katana Release (M1, M2, M3).
 * Triggered by DB-authorized release request event.
 * Claims saga atomically, publishes recipes behind the fence, creates exactly ONE
 * Katana Sales Order, creates MOs per item, and marks saga completed.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * - NO Katana deletion anywhere; zero rollback executor.
 * - NO wait primitives; completely stateless resume.
 * - Zero ghost demand: pre-release custom orders never exist in Katana.
 * - Concurrency serialization via KATANA_TENANT_CONCURRENCY + per-opp lock.
 * - Gated ONLY by GHL_FACTORY_ORDERS (getGhlFactoryOrderMode). ORDER_PIPELINE_MODE is the Woo
 *   Path B flag and must never enable these writes (QCA B1).
 *
 * Failure policy (QCA B4): once the saga is claimed (IN_PROGRESS), every Katana leg either
 *  - propagates a TRANSIENT failure (408/409/429/5xx/unknown) so Inngest retries it, or
 *  - on a TERMINAL failure (any other 4xx, a fence refusal, an `ok:false` result, an inconsistent
 *    response) calls markSagaManual(oppId, leg, err) and throws NonRetriableError, so the saga is
 *    SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION (which the UI can retry) and never stuck IN_PROGRESS.
 *  - a step that exhausts its retries (StepError) is converted the same way, unless the leg already
 *    marked the saga manual.
 */
import { and, eq } from "drizzle-orm";
import { NonRetriableError, StepError } from "inngest";
import { inngest } from "@/inngest/client";
import { runKatanaStep } from "@/inngest/katana-step";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import {
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  ensureKatanaVariantForSku,
  findKatanaSalesOrderByOrderNo,
  KatanaApiError,
  katanaFetch,
  syncBOMToKatana,
} from "@/lib/katana";
import { CC_MANUFACTURING_LOCATION_ID } from "@/server/ghl/hold-order";
import { parseKatanaListPayload, parseMoTreeNode } from "@/lib/katana-mto";
import {
  getGhlFactoryOrderMode,
  type GhlFactoryOrderMode,
} from "@/server/pipeline/ghl-factory-mode";
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
import { createReleaseStore, type ReleaseDb, type ReleaseStore } from "@/server/path-a/release-store";
import { createItemStore, type ItemStore } from "@/server/path-a/item-store";
import { createSagaStore, type SagaStore } from "@/server/sre/saga-store";
import { PathAFenceError } from "@/server/path-a/katana-fence";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";
import {
  PATH_A_GHL_SYNC_REQUESTED_EVENT,
  PATH_A_RELEASE_COMPLETED_EVENT,
  PATH_A_RELEASE_TO_PRODUCTION_EVENT,
  pathAGhlSyncEventId,
  pathAReleaseCompletedEventId,
  pathAReleaseEventSchema,
} from "@/server/path-a/events";

export type { ReleaseDb };

export type CatalogPublishMode = "log" | "live";

/**
 * Derives catalog publish mode strictly from CATALOG_PUBLISH_MODE.
 * Treat anything other than "live" as "log". Never call getCatalogPublishMode()
 * or fall back to ORDER_PIPELINE_MODE (D1: Zero Ghost Demand).
 */
export function getPathACatalogPublishMode(): CatalogPublishMode {
  return process.env.CATALOG_PUBLISH_MODE?.trim().toLowerCase() === "live" ? "live" : "log";
}

type ItemRow = typeof custom_build_job_items.$inferSelect;

/**
 * The item fields Function 2 reads. Deliberately excludes Date columns: this value is returned
 * from `step.run("validate-items")`, and Inngest memoizes step output as JSON (a Date would come
 * back as a string on resume).
 */
export type ReleaseItem = Pick<
  ItemRow,
  | "id"
  | "job_id"
  | "global_sku"
  | "quantity"
  | "design_status"
  | "finalized_dossier_hash"
  | "katana_sales_order_row_id"
  | "katana_mo_id"
>;

/**
 * The slice of the Inngest `step` API this function uses. Note there is intentionally NO
 * wait/sleep primitive at all (M2: stateless resume).
 */
type InngestStepTools = Parameters<
  Parameters<typeof inngest.createFunction>[1]
>[0]["step"];

export type ReleaseStep = Pick<InngestStepTools, "run" | "sendEvent">;

export type PathAReleaseDeps = {
  releaseStore?: ReleaseStore;
  itemStore?: ItemStore;
  sagaStore?: SagaStore;
  db?: ReleaseDb;
  /** GHL_FACTORY_ORDERS gate. Defaults to getGhlFactoryOrderMode (NOT ORDER_PIPELINE_MODE). */
  getFactoryOrderMode?: () => GhlFactoryOrderMode;
  getCatalogMode?: () => CatalogPublishMode;
  /** Public app origin for the cut-card link. Defaults to NEXT_PUBLIC_APP_URL (no fallback host). */
  getAppUrl?: () => string | undefined;
  findSalesOrder?: typeof findKatanaSalesOrderByOrderNo;
  createSalesOrder?: typeof createKatanaSalesOrder;
  createMos?: typeof createMakeToOrderManufacturingOrders;
  syncBom?: typeof syncBOMToKatana;
  ensureVariant?: typeof ensureKatanaVariantForSku;
  fetchKatana?: typeof katanaFetch;
  now?: () => Date;
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

const MANUAL_STATUS = "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION";

/** 4xx codes that mean "try again later", not "this request is wrong". */
const TRANSIENT_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 409, 429]);

/**
 * A terminal leg failure that is not a thrown Katana error: an `ok:false` result, or a response
 * that cannot be reconciled with the items. `leg` overrides the wrapper's leg name.
 */
class ReleaseLegError extends Error {
  constructor(
    message: string,
    readonly leg?: string,
  ) {
    super(message);
    this.name = "ReleaseLegError";
  }
}

function isTerminalLegFailure(err: unknown): boolean {
  if (err instanceof ReleaseLegError || err instanceof PathAFenceError) return true;
  if (err instanceof KatanaApiError) {
    return err.status >= 400 && err.status < 500 && !TRANSIENT_CLIENT_ERRORS.has(err.status);
  }
  return false;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Maps an Inngest step id to the manual-intervention leg name shown to operators. */
function legForStepId(stepId: string): string {
  if (stepId.startsWith("publish-recipe-")) {
    return `publish_recipe:${stepId.slice("publish-recipe-".length)}`;
  }
  if (stepId.startsWith("ensure-mo-")) {
    return `mo:${stepId.slice("ensure-mo-".length)}`;
  }
  if (stepId === "ensure-katana-sales-order") return "sales_order";
  return stepId.replace(/-/g, "_");
}

type SalesOrderLegResult = {
  salesOrderId: number;
  orderNo: string;
  rowsMap: Record<string, number>;
};

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

/**
 * Maps each item to its Sales Order row BY VARIANT ID ONLY (QCA M1: never by position, never by a
 * SKU guess). Returns null unless every item matches exactly one row with a positive integer id.
 */
function mapRowsByVariant(
  rows: unknown,
  items: ReleaseItem[],
  variantIdsBySku: Record<string, number>,
): Record<string, number> | null {
  const list = asRecordArray(rows);
  const map: Record<string, number> = {};
  for (const item of items) {
    const variantId = variantIdsBySku[item.global_sku];
    const matches = list.filter((row) => Number(row.variant_id) === variantId);
    if (matches.length !== 1) return null;
    const rowId = Number(matches[0].id);
    if (!Number.isInteger(rowId) || rowId <= 0) return null;
    map[item.global_sku] = rowId;
  }
  return map;
}

/**
 * Exact provenance (QCA M2): `additional_info` must carry exactly ONE Path A marker token and it
 * must be OUR opportunity's marker; no other token may even contain the marker prefix.
 */
function hasExactProvenanceMarker(additionalInfo: unknown, oppId: string): boolean {
  const tokens = String(additionalInfo ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean);
  const expected = `path_a_saga=${oppId}`;
  const ours = tokens.filter((t) => t === expected).length;
  const anyMarkerLike = tokens.filter((t) => t.includes("path_a_saga=")).length;
  return ours === 1 && anyMarkerLike === 1;
}

/**
 * Exact row-set equality (QCA M2): same number of rows, each expected variant present exactly
 * once, with the item's quantity. An order with EXTRA rows is not ours to adopt.
 */
function rowSetMatchesItems(
  rows: unknown,
  items: ReleaseItem[],
  variantIdsBySku: Record<string, number>,
): boolean {
  const list = asRecordArray(rows);
  if (list.length !== items.length) return false;
  for (const item of items) {
    const variantId = variantIdsBySku[item.global_sku];
    const matches = list.filter((row) => Number(row.variant_id) === variantId);
    if (matches.length !== 1) return false;
    if (Number(matches[0].quantity) !== Number(item.quantity)) return false;
  }
  return true;
}

export async function runPathAReleaseSaga(params: {
  event: { data?: unknown };
  step: ReleaseStep;
  deps?: PathAReleaseDeps;
}): Promise<PathAReleaseResult> {
  const { event, step, deps = {} } = params;

  // m2: the payload is validated with the shared schema; there is no "unknown" source fallback.
  const parsed = pathAReleaseEventSchema.safeParse(event.data);
  if (!parsed.success) {
    throw new NonRetriableError(
      `Invalid path-a/release-to-production payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const releaseEvent = parsed.data;
  const oppId = releaseEvent.ghlOpportunityId;

  const db = deps.db ?? getDb();
  const releaseStore = deps.releaseStore ?? createReleaseStore(() => db);
  const itemStore = deps.itemStore ?? createItemStore(() => db);
  const sagaStore = deps.sagaStore ?? createSagaStore(() => db);
  const getFactoryOrderModeFn = deps.getFactoryOrderMode ?? getGhlFactoryOrderMode;
  const getCatalogModeFn = deps.getCatalogMode ?? getPathACatalogPublishMode;
  const getAppUrlFn = deps.getAppUrl ?? (() => process.env.NEXT_PUBLIC_APP_URL);
  const findSalesOrderFn = deps.findSalesOrder ?? findKatanaSalesOrderByOrderNo;
  const createSalesOrderFn = deps.createSalesOrder ?? createKatanaSalesOrder;
  const createMosFn = deps.createMos ?? createMakeToOrderManufacturingOrders;
  const syncBomFn = deps.syncBom ?? syncBOMToKatana;
  const ensureVariantFn = deps.ensureVariant ?? ensureKatanaVariantForSku;
  const fetchKatanaFn = deps.fetchKatana ?? katanaFetch;
  const nowFn = deps.now ?? (() => new Date());

  /**
   * Runs ONE Katana leg's work. Must be called INSIDE a step function so the manual marking is
   * memoized with the step. Transient errors propagate untouched (Inngest retries them).
   */
  async function guardLeg<T>(leg: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof NonRetriableError || !isTerminalLegFailure(err)) {
        throw err;
      }
      const failedLeg = err instanceof ReleaseLegError && err.leg ? err.leg : leg;
      await releaseStore.markSagaManual(oppId, failedLeg, err);
      throw new NonRetriableError(`${failedLeg}: ${errorMessage(err)}`, { cause: err });
    }
  }

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

  // 2. read-modes (GHL_FACTORY_ORDERS gate; ORDER_PIPELINE_MODE is deliberately not consulted)
  const modes = await step.run("read-modes", async () => {
    const ghlFactoryMode = getFactoryOrderModeFn();
    const catalogMode = getCatalogModeFn();
    return { ghlFactoryMode, catalogMode };
  });

  if (modes.ghlFactoryMode !== "live") {
    await step.run(`release-dry-run`, async () => {
      const items = await itemStore.listItemsForOpportunity(oppId);
      console.log(
        JSON.stringify({
          tag: "path-a-release-dry-run",
          oppId,
          source: releaseEvent.source,
          itemCount: items.length,
        }),
      );
      await sagaStore.setStep(
        PATH_A_SAGA_TYPE,
        oppId,
        `release_dry_run:${releaseEvent.source}`,
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

  // 2b. check-config (m3): the cut-card link needs the configured origin. There is NO fallback
  // host: a missing value stops the release as manual before any Katana write.
  const appUrl = await step.run("check-config", async () => {
    const configured = getAppUrlFn()?.trim().replace(/\/$/, "") ?? "";
    if (!configured) {
      const err = new Error(
        "NEXT_PUBLIC_APP_URL is not configured: cannot build cut-card links for Katana MOs",
      );
      await releaseStore.markSagaManual(oppId, "config_app_url", err);
      throw new NonRetriableError(err.message);
    }
    return configured;
  });

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

  // 3. claim-release (single winner: a lost CAS is `not_ready`, see release-store M5)
  const claim = await step.run("claim-release", async () => {
    return releaseStore.claimRelease(oppId);
  });

  if (claim.outcome !== "claimed" && claim.outcome !== "resumed") {
    return {
      ok: claim.outcome === "already_completed",
      skipped: true,
      reason: claim.outcome,
      ghlOpportunityId: oppId,
    };
  }

  try {
    return await releaseClaimedSaga();
  } catch (err) {
    // A step that exhausted its retries surfaces here as a StepError. Leave the saga resumable
    // (manual-failed) instead of IN_PROGRESS forever. If the leg already marked it manual (the
    // failing step threw NonRetriableError after markSagaManual), do not overwrite its leg.
    if (err instanceof StepError) {
      const leg = legForStepId(err.stepId);
      const saga = await releaseStore.getSaga(oppId);
      if (saga?.status === "COMPLETED") {
        throw new NonRetriableError(`${leg}: ${errorMessage(err)}`, { cause: err });
      }
      await step.run(`mark-manual-${leg}`, async () => {
        const current = await releaseStore.getSaga(oppId);
        if (current?.status !== MANUAL_STATUS && current?.status !== "COMPLETED") {
          await releaseStore.markSagaManual(oppId, leg, err);
        }
      });
      throw new NonRetriableError(`${leg}: ${errorMessage(err)}`, { cause: err });
    }
    const postSaga = await releaseStore.getSaga(oppId);
    if (postSaga?.status === "COMPLETED") {
      throw new NonRetriableError(`post_completion: ${errorMessage(err)}`, { cause: err });
    }
    throw err;
  }

  async function releaseClaimedSaga(): Promise<PathAReleaseResult> {
    // 4. validate-items
    const items: ReleaseItem[] = await step.run("validate-items", async () => {
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

      const validated: ReleaseItem[] = [];
      for (const item of list) {
        // design_status is the real column (QCA B5: `status` does not exist).
        const designStatus = item.design_status;
        if (designStatus !== "finalized" && designStatus !== "released") {
          const msg = `Item ${item.global_sku} is in invalid status: ${designStatus}`;
          await releaseStore.markSagaManual(oppId, "validate_items", new Error(msg));
          throw new NonRetriableError(msg);
        }
        const qty = Number(item.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          const msg = `Item ${item.global_sku} has non-positive quantity: ${item.quantity}`;
          await releaseStore.markSagaManual(oppId, "validate_items", new Error(msg));
          throw new NonRetriableError(msg);
        }

        // Hash check 3.6.3: finalized_dossier_hash must equal factory_release_gate.dossier_hash.
        // An already-released item has been published; its gate may legitimately have moved on.
        if (designStatus === "finalized") {
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

        validated.push({
          id: item.id,
          job_id: item.job_id,
          global_sku: item.global_sku,
          quantity: item.quantity,
          design_status: item.design_status,
          finalized_dossier_hash: item.finalized_dossier_hash,
          katana_sales_order_row_id: item.katana_sales_order_row_id,
          katana_mo_id: item.katana_mo_id,
        });
      }

      return validated.sort((a, b) => a.global_sku.localeCompare(b.global_sku));
    });

    // 5. publish-recipe-<sku> (per item; already-released items are skipped)
    for (const item of items) {
      if (item.design_status === "released") continue;

      await runKatanaStep(step, `publish-recipe-${item.global_sku}`, () =>
        guardLeg(`publish_recipe:${item.global_sku}`, async () => {
          const ensured = await ensureVariantFn(item.global_sku);
          if (!ensured.ok) {
            throw new ReleaseLegError(
              `Katana variant could not be ensured for ${item.global_sku}: ${ensured.error}`,
            );
          }

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
            return { ok: true as const, idempotent: true };
          }

          const syncResult = await syncBomFn(item.global_sku, {
            fromAirlock: true,
            idempotencyKey: `factory-bom:${item.global_sku}:${item.finalized_dossier_hash}`,
            catalogMode: modes.catalogMode,
          });

          if (!syncResult.ok) {
            throw new ReleaseLegError(
              syncResult.error || `Failed to sync recipe for ${item.global_sku}`,
            );
          }
          if (syncResult.dryRun) {
            throw new ReleaseLegError(
              `Catalog publish mode is '${modes.catalogMode}' and recipe sync was dryRun for ${item.global_sku}; refusing to mint live orders against an unpublished recipe`,
              `publish_recipe:${item.global_sku}`,
            );
          }
          return { ok: true as const, idempotent: false };
        }),
      );
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

    // 6. ensure-katana-sales-order (ONE order for all items)
    const soInfo = await runKatanaStep<SalesOrderLegResult>(step, "ensure-katana-sales-order", () =>
      guardLeg("sales_order", async () => {
        const orderNo = katanaOrderNo("path_a", oppId);
        const existing = await findSalesOrderFn(orderNo);

        let salesOrderId: number;
        let rowsMap: Record<string, number>;

        if (existing) {
          // Adopt ONLY an order that is provably ours: exact marker AND exact row set.
          if (!hasExactProvenanceMarker(existing.additional_info, oppId)) {
            throw new ReleaseLegError(
              `Order ${orderNo} exists in Katana but lacks exactly one provenance marker path_a_saga=${oppId}`,
              "sales_order_provenance",
            );
          }
          if (!rowSetMatchesItems(existing.sales_order_rows, items, variantIdsBySku)) {
            throw new ReleaseLegError(
              `Order ${orderNo} rows do not exactly match the expected items (variants/quantities)`,
              "sales_order_provenance",
            );
          }
          const adoptedRows = mapRowsByVariant(existing.sales_order_rows, items, variantIdsBySku);
          if (!adoptedRows) {
            throw new ReleaseLegError(
              `Order ${orderNo} rows could not be mapped to items by variant id`,
              "sales_order_provenance",
            );
          }
          salesOrderId = Number(existing.id);
          rowsMap = adoptedRows;
        } else {
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

          salesOrderId = created.salesOrderId;
          let mapped = mapRowsByVariant(created.salesOrderRows, items, variantIdsBySku);
          if (!mapped) {
            // The create response did not carry variant-matchable rows. Re-read the order we just
            // created and map from THAT; never fall back to array position.
            const reread = await findSalesOrderFn(orderNo);
            mapped = reread
              ? mapRowsByVariant(reread.sales_order_rows, items, variantIdsBySku)
              : null;
          }
          if (!mapped) {
            throw new ReleaseLegError(
              `Sales Order ${orderNo} was created but its rows cannot be matched to items by variant id`,
            );
          }
          rowsMap = mapped;
        }

        if (!Number.isSafeInteger(salesOrderId) || salesOrderId <= 0) {
          throw new ReleaseLegError(`Sales Order ${orderNo} has no usable numeric id`);
        }

        // M3: persist on BOTH the create and the adopt path (a crash after the Katana create but
        // before this write must self-heal on the next run). The column is an integer.
        const now = nowFn();
        await db
          .update(custom_build_jobs)
          .set({
            katana_sales_order_id: salesOrderId,
            katana_order_no: orderNo,
            updated_at: now,
          })
          .where(eq(custom_build_jobs.ghl_opportunity_id, oppId));

        for (const item of items) {
          await db
            .update(custom_build_job_items)
            .set({
              katana_sales_order_row_id: rowsMap[item.global_sku],
              updated_at: now,
            })
            .where(eq(custom_build_job_items.id, item.id));
        }

        return { salesOrderId, orderNo, rowsMap };
      }),
    );

    // 7. ensure-mo-<sku> (per item; stamps the cut card, then marks the item released)
    const moIds: number[] = [];
    for (const item of items) {
      if (item.design_status === "released") {
        if (item.katana_mo_id) moIds.push(item.katana_mo_id);
        continue;
      }

      const moResult = await runKatanaStep<{ moId: number }>(step, `ensure-mo-${item.global_sku}`, () =>
        guardLeg(`mo:${item.global_sku}`, async () => {
          const rowId = soInfo.rowsMap[item.global_sku];
          if (!rowId) {
            throw new ReleaseLegError(`No sales order row id found for ${item.global_sku}`);
          }

          const { data: moListData } = await fetchKatanaFn<unknown>(
            `/manufacturing_orders?sales_order_id=${soInfo.salesOrderId}&limit=50`,
          );
          let existingMoId: number | null = null;
          for (const record of parseKatanaListPayload(moListData)) {
            const node = parseMoTreeNode(record);
            if (node && node.sales_order_row_id === rowId && node.id) {
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
            const matchCreated = createdMos.find((m) => m.salesOrderRowId === rowId);
            if (!matchCreated) {
              throw new ReleaseLegError(`Failed to create MO for row ${rowId}`);
            }
            finalMoId = matchCreated.manufacturingOrderId;
          }

          const { createCutCardToken } = await import("@/server/factory-bom/cut-card-token");
          const token = createCutCardToken({
            jobId: item.job_id,
            globalSku: item.global_sku,
          });
          const cutCardUrl = `${appUrl}/factory/cut-cards/${token}`;

          await fetchKatanaFn(`/manufacturing_orders/${finalMoId}`, {
            method: "PATCH",
            body: {
              additional_info: `custom_build=1\nCut card: ${cutCardUrl}`,
            },
          });

          await itemStore.markItemReleased({
            globalSku: item.global_sku,
            soRowId: rowId,
            moId: finalMoId,
          });

          return { moId: finalMoId };
        }),
      );
      moIds.push(moResult.moId);
    }

    await step.run("persist-job-mo-ids", async () => {
      const now = nowFn();
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

    // M9: the sync id follows the release attempt, so a retried release is never deduped away.
    await step.sendEvent("send-ghl-sync-event", {
      id: pathAGhlSyncEventId(oppId, releaseEvent.attempt),
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
    // Forward step tools adhering to the ReleaseStep contract.
    return runPathAReleaseSaga({ event, step });
  },
);
