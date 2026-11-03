/**
 * Phase 15 — Katana reverse-flow Sales Order & Manufacturing Order status listeners
 * and hourly open-order reconciliation cron (§15.4c, §VI R-1/R-2/R-3/R-9/R-10/R-12, §VII S-1).
 *
 * Invariants:
 *  - Zero QBO, GHL, WooCommerce, or Clover imports (Katana-slot isolation, D-11).
 *  - `katanaMoDone` and `katanaOrderStatusReconcile` are Postgres-only (zero Katana calls,
 *    no `KATANA_TENANT_CONCURRENCY`).
 *  - Every Katana reader runs strictly inside `runKatanaStep` (`assertKatanaDeferContext`).
 *  - Hub persistence uses a single conditional compare-and-set SQL UPDATE (`katana_status_observed_at`)
 *    with `COALESCE` stage-rank monotonicity, and never touches `order_intake.status` or `version`.
 */

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { assertKatanaDeferContext, runKatanaStep } from "./katana-step";
import { KatanaApiError, katanaFetch } from "@/lib/katana";
import { parseKatanaListPayload } from "@/lib/katana-mto";
import { logStructured } from "@/lib/log/structured";
import { getDb, type MiddlewareDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  order_intake,
  saga_runs,
  type FactoryStage,
} from "@/server/db/schema";
import {
  deriveFactoryStage,
  laneForOrderNo,
  opportunityIdFromOrderNo,
  rankOfFactoryStage,
  readManufacturingOrderSnapshot,
  readSalesOrderSnapshot,
  type KatanaMoSnapshot,
  type KatanaSoSnapshot,
} from "@/server/katana/order-status";
import {
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
  positiveInt,
} from "@/server/katana/webhook-events";
import { GHL_FACTORY_STAGE_PUSH_EVENT } from "@/server/pipeline/katana-reverse-mode";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/events";
import { inngestEventId } from "@/server/sre/idempotency";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";

export {
  GHL_FACTORY_STAGE_PUSH_EVENT,
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
};

const MO_LISTING_PAGE_SIZE = 50;
const MO_LISTING_MAX_PAGES = 10;
export const RECONCILE_BATCH_LIMIT = 25;

export async function fetchKatanaSalesOrderSnapshot(
  salesOrderId: number,
): Promise<KatanaSoSnapshot | null> {
  assertKatanaDeferContext("fetchKatanaSalesOrderSnapshot");
  try {
    const { data } = await katanaFetch<unknown>(`/sales_orders/${salesOrderId}`);
    return readSalesOrderSnapshot(data);
  } catch (error) {
    if (error instanceof KatanaApiError) {
      if (error.status === 404) {
        return null;
      }
      if (
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 409 &&
        error.status !== 429
      ) {
        throw new NonRetriableError(error.message, { cause: error });
      }
    }
    throw error;
  }
}

export async function listKatanaMoSnapshotsForSalesOrder(
  salesOrderId: number,
): Promise<KatanaMoSnapshot[]> {
  assertKatanaDeferContext("listKatanaMoSnapshotsForSalesOrder");
  const snapshots: KatanaMoSnapshot[] = [];

  for (let page = 1; page <= MO_LISTING_MAX_PAGES; page += 1) {
    const query = new URLSearchParams();
    query.set("sales_order_id", String(salesOrderId));
    query.set("limit", String(MO_LISTING_PAGE_SIZE));
    query.set("page", String(page));

    const { data } = await katanaFetch<unknown>(
      `/manufacturing_orders?${query.toString()}`,
    );
    const records = parseKatanaListPayload(data);
    for (const record of records) {
      const snap = readManufacturingOrderSnapshot(record);
      if (snap.salesOrderId === salesOrderId) {
        snapshots.push(snap);
      }
    }
    if (records.length < MO_LISTING_PAGE_SIZE) {
      return snapshots;
    }
  }

  throw new KatanaApiError(
    `Sales order ${salesOrderId} has more than ${MO_LISTING_MAX_PAGES * MO_LISTING_PAGE_SIZE} manufacturing orders; the listing cannot be exhausted.`,
    { status: 422 },
  );
}

type OrderStatusDb = Pick<MiddlewareDb, "select" | "update" | "execute">;

type MoHubLookupResult =
  | { state: "hit"; salesOrderId: number }
  | { state: "so_not_persisted_yet" }
  | { state: "mo_not_in_hub" };

async function lookupHubSalesOrderForMo(
  db: OrderStatusDb,
  moId: number,
): Promise<MoHubLookupResult> {
  const needleJson = JSON.stringify([moId]);

  const [intakeHit] = await db
    .select({ katana_sales_order_id: order_intake.katana_sales_order_id })
    .from(order_intake)
    .where(
      sql`${order_intake.katana_mo_ids} IS NOT NULL AND ${order_intake.katana_mo_ids} @> ${needleJson}::jsonb`,
    )
    .limit(1);

  if (intakeHit) {
    if (intakeHit.katana_sales_order_id != null && intakeHit.katana_sales_order_id > 0) {
      return { state: "hit", salesOrderId: intakeHit.katana_sales_order_id };
    }
    return { state: "so_not_persisted_yet" };
  }

  const [jobHit] = await db
    .select({ katana_sales_order_id: custom_build_jobs.katana_sales_order_id })
    .from(custom_build_jobs)
    .where(
      sql`${custom_build_jobs.katana_mo_ids} IS NOT NULL AND ${custom_build_jobs.katana_mo_ids} @> ${needleJson}::jsonb`,
    )
    .limit(1);

  if (jobHit) {
    if (jobHit.katana_sales_order_id != null && jobHit.katana_sales_order_id > 0) {
      return { state: "hit", salesOrderId: jobHit.katana_sales_order_id };
    }
    return { state: "so_not_persisted_yet" };
  }

  const [itemHit] = await db
    .select({ katana_sales_order_id: custom_build_jobs.katana_sales_order_id })
    .from(custom_build_job_items)
    .innerJoin(
      custom_build_jobs,
      eq(custom_build_job_items.job_id, custom_build_jobs.id),
    )
    .where(eq(custom_build_job_items.katana_mo_id, moId))
    .limit(1);

  if (itemHit) {
    if (itemHit.katana_sales_order_id != null && itemHit.katana_sales_order_id > 0) {
      return { state: "hit", salesOrderId: itemHit.katana_sales_order_id };
    }
    return { state: "so_not_persisted_yet" };
  }

  return { state: "mo_not_in_hub" };
}

export type MoDoneStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sleep: (id: string, duration: string) => Promise<unknown>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

export async function runKatanaMoDone(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: MoDoneStepLike;
  },
  deps: { getDb?: () => OrderStatusDb } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const manufacturingOrderId = positiveInt(input.event.data?.manufacturingOrderId);
  if (!manufacturingOrderId) {
    throw new NonRetriableError(
      `${KATANA_MO_DONE_EVENT} requires a positive manufacturingOrderId`,
    );
  }

  let lookup = await input.step.run("lookup-hub", () =>
    lookupHubSalesOrderForMo(resolveDb(), manufacturingOrderId),
  );

  // §VII S-1.3: if the MO finished before the push persisted `katana_mo_ids` / `katana_sales_order_id`,
  // sleep once and re-check before dropping to the hourly reconcile cron.
  if (lookup.state !== "hit") {
    await input.step.sleep("await-hub-persist", "2m");
    lookup = await input.step.run("lookup-hub-after-wait", () =>
      lookupHubSalesOrderForMo(resolveDb(), manufacturingOrderId),
    );
  }

  if (lookup.state !== "hit") {
    return { ok: true as const, skipped: lookup.state };
  }

  await input.step.sendEvent("emit-so-status", {
    id: inngestEventId(
      "katana:so",
      lookup.salesOrderId,
      `mo_done:${manufacturingOrderId}`,
    ),
    name: KATANA_SO_STATUS_EVENT,
    data: {
      salesOrderId: lookup.salesOrderId,
      action: "manufacturing_order.done",
      source: "mo_done",
    },
  });

  return {
    ok: true as const,
    salesOrderId: lookup.salesOrderId,
  };
}

export const katanaMoDone = inngest.createFunction(
  {
    id: "katana-mo-done",
    name: "Katana MO Done -> resolve sales order",
    triggers: [{ event: KATANA_MO_DONE_EVENT }],
    idempotency: "event.data.manufacturingOrderId",
    retries: 3,
  },
  async ({ event, step }) =>
    runKatanaMoDone({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as MoDoneStepLike,
    }),
);

type PersistHubStatusOutcome =
  | { outcome: "skipped"; reason: "hub_record_missing" | "stale_snapshot" }
  | {
      outcome: "updated";
      lane: "ghl_factory" | "path_a";
      rowId: string;
      opportunityId: string;
      persistedStage: FactoryStage | null;
      previousStage: string | null;
      ghlStagePushed: string | null;
    };

async function persistHubStatusSnapshot(
  db: OrderStatusDb,
  so: KatanaSoSnapshot,
  mos: readonly KatanaMoSnapshot[],
  observedAt: string,
  laneInfo: { lane: "ghl_factory" | "path_a"; opportunityId: string },
): Promise<PersistHubStatusOutcome> {
  const { lane, opportunityId } = laneInfo;

  let rowId: string;
  let storedSoId: number | null;
  let storedStage: string | null;
  let baseMoIds: number[];

  if (lane === "ghl_factory") {
    const [row] = await db
      .select({
        id: order_intake.id,
        katana_sales_order_id: order_intake.katana_sales_order_id,
        katana_mo_ids: order_intake.katana_mo_ids,
        factory_stage: order_intake.factory_stage,
      })
      .from(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, opportunityId))
      .limit(1);

    if (!row) {
      logStructured("info", "katana-reverse-sync-hub-missing", {
        orderNo: so.orderNo,
        lane,
        salesOrderId: so.id,
      });
      return { outcome: "skipped", reason: "hub_record_missing" };
    }
    rowId = row.id;
    storedSoId = row.katana_sales_order_id;
    storedStage = row.factory_stage;
    baseMoIds = Array.isArray(row.katana_mo_ids) ? row.katana_mo_ids : [];
  } else {
    const [row] = await db
      .select({
        id: custom_build_jobs.id,
        katana_sales_order_id: custom_build_jobs.katana_sales_order_id,
        katana_mo_ids: custom_build_jobs.katana_mo_ids,
        factory_stage: custom_build_jobs.factory_stage,
      })
      .from(custom_build_jobs)
      .where(eq(custom_build_jobs.ghl_opportunity_id, opportunityId))
      .limit(1);

    if (!row) {
      logStructured("info", "katana-reverse-sync-hub-missing", {
        orderNo: so.orderNo,
        lane,
        salesOrderId: so.id,
      });
      return { outcome: "skipped", reason: "hub_record_missing" };
    }
    rowId = row.id;
    storedSoId = row.katana_sales_order_id;
    storedStage = row.factory_stage;

    const itemRows = await db
      .select({ katana_mo_id: custom_build_job_items.katana_mo_id })
      .from(custom_build_job_items)
      .where(eq(custom_build_job_items.job_id, row.id));
    const itemMoIds = itemRows
      .map((item) => item.katana_mo_id)
      .filter((id): id is number => typeof id === "number" && id > 0);
    baseMoIds = [
      ...(Array.isArray(row.katana_mo_ids) ? row.katana_mo_ids : []),
      ...itemMoIds,
    ];
  }

  // §VI R-2.2: Duplicate-SO integrity alarm.
  if (storedSoId !== null && storedSoId !== so.id) {
    throw new NonRetriableError(
      `Katana SO ${so.id} (${so.orderNo}) conflicts with hub SO ${storedSoId}: duplicate sales order in Katana`,
    );
  }

  const derivedStage = deriveFactoryStage(so, mos, baseMoIds);
  const derivedRank = rankOfFactoryStage(derivedStage);
  const storedRankBefore = rankOfFactoryStage(storedStage);

  const doneIds = mos
    .filter((m) => m.salesOrderId === so.id && m.status === "DONE")
    .map((m) => m.id)
    .sort((a, b) => a - b);
  const doneIdsJson = JSON.stringify(doneIds);

  // §VI R-3.3 + §VII S-1.1: Single compare-and-set UPDATE on `katana_status_observed_at`
  // with COALESCE on both stored and derived stage ranks.
  if (lane === "ghl_factory") {
    const updatedRows = await db
      .update(order_intake)
      .set({
        katana_so_status: so.status,
        katana_production_status: so.productionStatus,
        katana_mo_done_ids: sql`${doneIdsJson}::jsonb`,
        factory_stage: sql`CASE WHEN ${derivedRank} > COALESCE(CASE ${order_intake.factory_stage} WHEN 'in_production' THEN 1 WHEN 'build_complete' THEN 2 WHEN 'ready_to_ship' THEN 3 WHEN 'delivered' THEN 4 ELSE 0 END, 0) THEN ${derivedStage} ELSE ${order_intake.factory_stage} END`,
        katana_status_observed_at: sql`${observedAt}::timestamptz`,
        katana_status_synced_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where(
        and(
          eq(order_intake.id, rowId),
          sql`(${order_intake.katana_status_observed_at} IS NULL OR ${order_intake.katana_status_observed_at} < ${observedAt}::timestamptz)`,
        ),
      )
      .returning({
        factory_stage: order_intake.factory_stage,
        ghl_stage_pushed: order_intake.ghl_stage_pushed,
      });

    if (!updatedRows[0]) {
      logStructured("info", "katana-reverse-sync-stale-snapshot", {
        orderNo: so.orderNo,
        salesOrderId: so.id,
        observedAt,
      });
      return { outcome: "skipped", reason: "stale_snapshot" };
    }

    if (storedRankBefore > derivedRank) {
      logStructured("warn", "katana-status-regression", {
        orderNo: so.orderNo,
        salesOrderId: so.id,
        storedStage,
        derivedStage,
      });
    }

    return {
      outcome: "updated",
      lane,
      rowId,
      opportunityId,
      persistedStage: (updatedRows[0].factory_stage as FactoryStage | null) ?? null,
      previousStage: storedStage,
      ghlStagePushed: updatedRows[0].ghl_stage_pushed,
    };
  }

  const updatedJobRows = await db
    .update(custom_build_jobs)
    .set({
      katana_so_status: so.status,
      katana_production_status: so.productionStatus,
      katana_mo_done_ids: sql`${doneIdsJson}::jsonb`,
      factory_stage: sql`CASE WHEN ${derivedRank} > COALESCE(CASE ${custom_build_jobs.factory_stage} WHEN 'in_production' THEN 1 WHEN 'build_complete' THEN 2 WHEN 'ready_to_ship' THEN 3 WHEN 'delivered' THEN 4 ELSE 0 END, 0) THEN ${derivedStage} ELSE ${custom_build_jobs.factory_stage} END`,
      katana_status_observed_at: sql`${observedAt}::timestamptz`,
      katana_status_synced_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(custom_build_jobs.id, rowId),
        sql`(${custom_build_jobs.katana_status_observed_at} IS NULL OR ${custom_build_jobs.katana_status_observed_at} < ${observedAt}::timestamptz)`,
      ),
    )
    .returning({
      factory_stage: custom_build_jobs.factory_stage,
      ghl_stage_pushed: custom_build_jobs.ghl_stage_pushed,
    });

  if (!updatedJobRows[0]) {
    logStructured("info", "katana-reverse-sync-stale-snapshot", {
      orderNo: so.orderNo,
      salesOrderId: so.id,
      observedAt,
    });
    return { outcome: "skipped", reason: "stale_snapshot" };
  }

  if (storedRankBefore > derivedRank) {
    logStructured("warn", "katana-status-regression", {
      orderNo: so.orderNo,
      salesOrderId: so.id,
      storedStage,
      derivedStage,
    });
  }

  return {
    outcome: "updated",
    lane,
    rowId,
    opportunityId,
    persistedStage: (updatedJobRows[0].factory_stage as FactoryStage | null) ?? null,
    previousStage: storedStage,
    ghlStagePushed: updatedJobRows[0].ghl_stage_pushed,
  };
}

export type OrderStatusStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: { opportunityId: string } },
  ) => Promise<unknown>;
};

export type SyncKatanaOrderStatusDeps = {
  getDb?: () => OrderStatusDb;
  fetchSalesOrder?: (salesOrderId: number) => Promise<KatanaSoSnapshot | null>;
  listMosForSalesOrder?: (salesOrderId: number) => Promise<KatanaMoSnapshot[]>;
  nowIso?: () => string;
};

export async function runSyncKatanaOrderStatus(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: OrderStatusStepLike;
  },
  deps: SyncKatanaOrderStatusDeps = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const fetchSo = deps.fetchSalesOrder ?? fetchKatanaSalesOrderSnapshot;
  const listMos = deps.listMosForSalesOrder ?? listKatanaMoSnapshotsForSalesOrder;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const salesOrderId = positiveInt(input.event.data?.salesOrderId);
  if (!salesOrderId) {
    throw new NonRetriableError(
      `${KATANA_SO_STATUS_EVENT} requires a positive salesOrderId`,
    );
  }

  // Step 1: Capture `observedAt` strictly inside `fetch-katana-sales-order` (§VII S-1.6).
  const soEnvelope = await runKatanaStep<{
    so: KatanaSoSnapshot | null;
    observedAt: string;
  }>(
    input.step,
    "fetch-katana-sales-order",
    async () => {
      const so = await fetchSo(salesOrderId);
      return { so, observedAt: nowIso() };
    },
  );

  if (!soEnvelope.so) {
    return { ok: true as const, skipped: "katana_so_not_found" as const };
  }
  const { so, observedAt } = soEnvelope;

  // Step 2: Strict throwing MO paginator.
  const mos = await runKatanaStep<KatanaMoSnapshot[]>(
    input.step,
    "fetch-katana-mos",
    () => listMos(so.id),
  );

  // Step 3: Closed-prefix lane routing before any DB write (§15.4c, QA-15.4-06).
  const lane = laneForOrderNo(so.orderNo);
  const laneInfo = opportunityIdFromOrderNo(so.orderNo);
  if (lane === "woo" || lane === "unknown" || !laneInfo) {
    return {
      ok: true as const,
      skipped: `lane_${lane}` as const,
    };
  }

  // Step 4: Conditional compare-and-set hub persistence.
  const persisted = await input.step.run("persist-hub-status", () =>
    persistHubStatusSnapshot(resolveDb(), so, mos, observedAt, laneInfo),
  );

  if (persisted.outcome === "skipped") {
    return { ok: true as const, skipped: persisted.reason };
  }

  // §VI R-1.3 + §VII S-1.5: Emit `ghl/factory_stage.push_requested` with ONLY `{ opportunityId }`
  // when the persisted stage rank exceeds the stored `ghl_stage_pushed` rank.
  const persistedRank = rankOfFactoryStage(persisted.persistedStage);
  const pushedRank = rankOfFactoryStage(persisted.ghlStagePushed);

  if (
    persisted.persistedStage !== null &&
    persisted.opportunityId &&
    persistedRank > pushedRank
  ) {
    const opportunityId = persisted.opportunityId;
    await input.step.sendEvent("request-ghl-stage", {
      name: GHL_FACTORY_STAGE_PUSH_EVENT,
      data: { opportunityId },
    });
  }

  return {
    ok: true as const,
    lane: persisted.lane,
    stage: persisted.persistedStage,
    opportunityId: persisted.opportunityId,
  };
}

export const syncKatanaOrderStatus = inngest.createFunction(
  {
    id: "sync-katana-order-status",
    name: "Katana order status -> Hub -> GHL stage",
    triggers: [{ event: KATANA_SO_STATUS_EVENT }],
    concurrency: [
      { limit: 1, key: "event.data.salesOrderId" },
      KATANA_TENANT_CONCURRENCY,
    ],
    debounce: {
      key: "event.data.salesOrderId",
      period: "20s",
      timeout: "2m",
    },
    retries: 3,
  },
  async ({ event, step }) =>
    runSyncKatanaOrderStatus({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as OrderStatusStepLike,
    }),
);

type ReconcileCandidate = {
  salesOrderId: number;
  syncedAtMs: number;
  createdAtMs: number;
};

async function selectReconcileSalesOrderIds(
  db: OrderStatusDb,
  now: Date,
): Promise<number[]> {
  const sixHoursAgoIso = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  // Clause 1 (§VI R-10.4): open hub rows unsynced or older than 6 hours.
  const intakeSixHour = await db
    .select({
      soId: order_intake.katana_sales_order_id,
      syncedAt: order_intake.katana_status_synced_at,
      createdAt: order_intake.created_at,
    })
    .from(order_intake)
    .where(
      and(
        ne(order_intake.status, "rejected"),
        sql`${order_intake.katana_sales_order_id} IS NOT NULL`,
        sql`(${order_intake.factory_stage} IS NULL OR ${order_intake.factory_stage} <> 'delivered')`,
        sql`(${order_intake.katana_status_synced_at} IS NULL OR ${order_intake.katana_status_synced_at} < ${sixHoursAgoIso}::timestamptz)`,
      ),
    )
    .orderBy(
      sql`${order_intake.katana_status_synced_at} ASC NULLS FIRST`,
      asc(order_intake.created_at),
    )
    .limit(RECONCILE_BATCH_LIMIT);

  const jobsSixHour = await db
    .select({
      soId: custom_build_jobs.katana_sales_order_id,
      syncedAt: custom_build_jobs.katana_status_synced_at,
      createdAt: custom_build_jobs.created_at,
      sagaStatus: saga_runs.status,
    })
    .from(custom_build_jobs)
    .leftJoin(
      saga_runs,
      and(
        eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
        eq(saga_runs.correlation_key, custom_build_jobs.ghl_opportunity_id),
      ),
    )
    .where(
      and(
        sql`${custom_build_jobs.katana_sales_order_id} IS NOT NULL`,
        sql`(${custom_build_jobs.factory_stage} IS NULL OR ${custom_build_jobs.factory_stage} <> 'delivered')`,
        sql`(${custom_build_jobs.katana_status_synced_at} IS NULL OR ${custom_build_jobs.katana_status_synced_at} < ${sixHoursAgoIso}::timestamptz)`,
        sql`(${saga_runs.status} IS NULL OR ${saga_runs.status} <> 'COMPENSATED')`,
      ),
    )
    .orderBy(
      sql`${custom_build_jobs.katana_status_synced_at} ASC NULLS FIRST`,
      asc(custom_build_jobs.created_at),
    )
    .limit(RECONCILE_BATCH_LIMIT);

  const normalize = (
    rows: Array<{ soId: number | null; syncedAt: Date | null; createdAt: Date }>,
  ): ReconcileCandidate[] =>
    rows
      .filter((r): r is { soId: number; syncedAt: Date | null; createdAt: Date } =>
        typeof r.soId === "number" && r.soId > 0,
      )
      .map((r) => ({
        salesOrderId: r.soId,
        syncedAtMs: r.syncedAt ? r.syncedAt.getTime() : -1,
        createdAtMs: r.createdAt ? r.createdAt.getTime() : 0,
      }));

  const clause1 = [...normalize(intakeSixHour), ...normalize(jobsSixHour)].sort(
    (a, b) => a.syncedAtMs - b.syncedAtMs || a.createdAtMs - b.createdAtMs,
  );

  const chosen: number[] = [];
  const seen = new Set<number>();
  for (const item of clause1) {
    if (chosen.length >= RECONCILE_BATCH_LIMIT) break;
    if (!seen.has(item.salesOrderId)) {
      seen.add(item.salesOrderId);
      chosen.push(item.salesOrderId);
    }
  }

  if (chosen.length >= RECONCILE_BATCH_LIMIT) {
    return chosen;
  }

  // Clause 2 (§VII S-1.4): early-stage rows (`NULL` or `in_production`) older than 1 hour.
  const intakeOneHour = await db
    .select({
      soId: order_intake.katana_sales_order_id,
      syncedAt: order_intake.katana_status_synced_at,
      createdAt: order_intake.created_at,
    })
    .from(order_intake)
    .where(
      and(
        ne(order_intake.status, "rejected"),
        sql`${order_intake.katana_sales_order_id} IS NOT NULL`,
        sql`(${order_intake.factory_stage} IS NULL OR ${order_intake.factory_stage} = 'in_production')`,
        sql`${order_intake.katana_status_synced_at} < ${oneHourAgoIso}::timestamptz`,
      ),
    )
    .orderBy(
      sql`${order_intake.katana_status_synced_at} ASC NULLS FIRST`,
      asc(order_intake.created_at),
    )
    .limit(RECONCILE_BATCH_LIMIT);

  const jobsOneHour = await db
    .select({
      soId: custom_build_jobs.katana_sales_order_id,
      syncedAt: custom_build_jobs.katana_status_synced_at,
      createdAt: custom_build_jobs.created_at,
    })
    .from(custom_build_jobs)
    .leftJoin(
      saga_runs,
      and(
        eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
        eq(saga_runs.correlation_key, custom_build_jobs.ghl_opportunity_id),
      ),
    )
    .where(
      and(
        sql`${custom_build_jobs.katana_sales_order_id} IS NOT NULL`,
        sql`(${custom_build_jobs.factory_stage} IS NULL OR ${custom_build_jobs.factory_stage} = 'in_production')`,
        sql`${custom_build_jobs.katana_status_synced_at} < ${oneHourAgoIso}::timestamptz`,
        sql`(${saga_runs.status} IS NULL OR ${saga_runs.status} <> 'COMPENSATED')`,
      ),
    )
    .orderBy(
      sql`${custom_build_jobs.katana_status_synced_at} ASC NULLS FIRST`,
      asc(custom_build_jobs.created_at),
    )
    .limit(RECONCILE_BATCH_LIMIT);

  const clause2 = [...normalize(intakeOneHour), ...normalize(jobsOneHour)].sort(
    (a, b) => a.syncedAtMs - b.syncedAtMs || a.createdAtMs - b.createdAtMs,
  );

  for (const item of clause2) {
    if (chosen.length >= RECONCILE_BATCH_LIMIT) break;
    if (!seen.has(item.salesOrderId)) {
      seen.add(item.salesOrderId);
      chosen.push(item.salesOrderId);
    }
  }

  return chosen;
}

export function formatReconcileHourBucket(now: Date): string {
  return now.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

export type ReconcileStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload:
      | Array<{ id: string; name: string; data: Record<string, unknown> }>
      | { id: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

export async function runKatanaOrderStatusReconcile(
  input: { step: ReconcileStepLike },
  deps: { getDb?: () => OrderStatusDb; now?: () => Date } = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const nowFn = deps.now ?? (() => new Date());

  const { salesOrderIds, hourBucket } = await input.step.run(
    "select-open-orders",
    async () => {
      const now = nowFn();
      const ids = await selectReconcileSalesOrderIds(resolveDb(), now);
      return {
        salesOrderIds: ids,
        hourBucket: formatReconcileHourBucket(now),
      };
    },
  );

  if (salesOrderIds.length === 0) {
    return { ok: true as const, count: 0 };
  }

  const events = salesOrderIds.map((soId) => ({
    id: inngestEventId("katana:so", soId, `reconcile:${hourBucket}`),
    name: KATANA_SO_STATUS_EVENT,
    data: {
      salesOrderId: soId,
      action: "reconcile",
      source: "reconcile",
    },
  }));

  await input.step.sendEvent("emit-reconcile-events", events);
  return { ok: true as const, count: events.length, hourBucket };
}

export const katanaOrderStatusReconcile = inngest.createFunction(
  {
    id: "katana-order-status-reconcile",
    name: "Reconcile open Katana order statuses",
    triggers: [{ cron: "15 * * * *" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) =>
    runKatanaOrderStatusReconcile({
      step: step as unknown as ReconcileStepLike,
    }),
);
