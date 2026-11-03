/**
 * Phase 15 — GoHighLevel factory stage push worker (§VI R-1.4/R-3.4/R-9.4/R-11, §VII S-1.2/S-1.5).
 *
 * Invariants:
 *  - Zero Katana imports and no `KATANA_TENANT_CONCURRENCY` (Katana-slot isolation, D-11).
 *  - Target stage is ALWAYS computed from live hub rows at run time, never from event data.
 *  - Multi-lane aggregation: minimum rank across every live `order_intake` and `custom_build_jobs`
 *    row for the opportunity. A live row with `factory_stage IS NULL` has rank 0 and blocks the push.
 *  - `KATANA_REVERSE_SYNC_MODE !== "live"` exits before any GHL GET or PUT.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { NonRetriableError, RetryAfterError } from "inngest";
import { inngest } from "./client";
import { logStructured } from "@/lib/log/structured";
import { getDb, type MiddlewareDb } from "@/server/db/client";
import {
  FACTORY_STAGES,
  custom_build_jobs,
  order_intake,
  saga_runs,
  type FactoryStage,
} from "@/server/db/schema";
import {
  assertStageConfigDisjoint,
  moveOpportunityStage,
  stageIdFor,
  validateGhlStageConfigAgainstPipelines,
  type GhlStageEnvMap,
  type MoveOpportunityStageDeps,
} from "@/server/ghl/opportunity-stage";
import { ghlGet, ghlPut } from "@/server/ghl/private-api";
import {
  PATH_A_GHL_SYNC_REQUESTED_EVENT,
  PATH_A_SAGA_TYPE,
} from "@/server/path-a/events";
import {
  GHL_FACTORY_STAGE_PUSH_EVENT,
  canPushGhlFactoryStage,
} from "@/server/pipeline/katana-reverse-mode";
import { inngestEventId } from "@/server/sre/idempotency";

export { GHL_FACTORY_STAGE_PUSH_EVENT };

const STAGE_RANK: Record<FactoryStage, number> = {
  in_production: 1,
  build_complete: 2,
  ready_to_ship: 3,
  delivered: 4,
};

const VALID_STAGES: ReadonlySet<string> = new Set(FACTORY_STAGES);

function rankOfStage(stage: string | null | undefined): number {
  if (!stage || !VALID_STAGES.has(stage)) return 0;
  return STAGE_RANK[stage as FactoryStage];
}

function stageFromRank(rank: number): FactoryStage | null {
  switch (rank) {
    case 1:
      return "in_production";
    case 2:
      return "build_complete";
    case 3:
      return "ready_to_ship";
    case 4:
      return "delivered";
    default:
      return null;
  }
}

type StagePushDb = Pick<MiddlewareDb, "select" | "update">;

type ComputedTarget =
  | {
      action: "skip";
      reason: "no_live_hub_rows" | "awaiting_all_lanes" | "already_pushed";
      targetStage: FactoryStage | null;
    }
  | {
      action: "push";
      targetStage: FactoryStage;
      targetRank: number;
      hasPathARow: boolean;
      intakeIds: string[];
      jobIds: string[];
    };

async function computeOpportunityTargetStage(
  db: StagePushDb,
  opportunityId: string,
): Promise<ComputedTarget> {
  // Live `order_intake` rows exclude only `status = 'rejected'` (§VII S-1.2).
  const intakeRows = await db
    .select({
      id: order_intake.id,
      factory_stage: order_intake.factory_stage,
      ghl_stage_pushed: order_intake.ghl_stage_pushed,
    })
    .from(order_intake)
    .where(
      and(
        eq(order_intake.ghl_opportunity_id, opportunityId),
        ne(order_intake.status, "rejected"),
      ),
    );

  // Live `custom_build_jobs` rows exclude cancelled/rolled-back Path A sagas (`COMPENSATED`, V-14b).
  const rawJobRows = await db
    .select({
      id: custom_build_jobs.id,
      factory_stage: custom_build_jobs.factory_stage,
      ghl_stage_pushed: custom_build_jobs.ghl_stage_pushed,
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
    .where(eq(custom_build_jobs.ghl_opportunity_id, opportunityId));

  const jobRows = rawJobRows.filter((row) => row.sagaStatus !== "COMPENSATED");

  const allLive = [...intakeRows, ...jobRows];
  if (allLive.length === 0) {
    return { action: "skip", reason: "no_live_hub_rows", targetStage: null };
  }

  let minRank = Infinity;
  for (const row of allLive) {
    const r = rankOfStage(row.factory_stage);
    if (r < minRank) minRank = r;
  }

  // A live row with `factory_stage IS NULL` has rank 0 and blocks the push (§VII S-1.2).
  if (minRank <= 0 || !Number.isFinite(minRank)) {
    return { action: "skip", reason: "awaiting_all_lanes", targetStage: null };
  }

  const targetStage = stageFromRank(minRank);
  if (!targetStage) {
    return { action: "skip", reason: "awaiting_all_lanes", targetStage: null };
  }

  const allAlreadyPushed = allLive.every(
    (row) => rankOfStage(row.ghl_stage_pushed) >= minRank,
  );
  if (allAlreadyPushed) {
    return { action: "skip", reason: "already_pushed", targetStage };
  }

  return {
    action: "push",
    targetStage,
    targetRank: minRank,
    hasPathARow: jobRows.length > 0,
    intakeIds: intakeRows.map((r) => r.id),
    jobIds: jobRows.map((r) => r.id),
  };
}

function rethrowGhlTransportError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/returned 40[13]\b/.test(message)) {
    throw new NonRetriableError(message, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (/returned 429\b/.test(message)) {
    throw new RetryAfterError(message, "30s");
  }
  throw error instanceof Error ? error : new Error(message);
}

export type PushGhlStageStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

export type PushGhlFactoryStageDeps = {
  getDb?: () => StagePushDb;
  ghl?: MoveOpportunityStageDeps;
  env?: GhlStageEnvMap;
};

export async function runPushGhlFactoryStage(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: PushGhlStageStepLike;
  },
  deps: PushGhlFactoryStageDeps = {},
) {
  const resolveDb = deps.getDb ?? getDb;
  const ghlDeps = deps.ghl ?? { getGhl: ghlGet, putGhl: ghlPut };
  const env = deps.env ?? process.env;

  const opportunityId = String(input.event.data?.opportunityId ?? "").trim();
  if (!opportunityId) {
    throw new NonRetriableError(
      `${GHL_FACTORY_STAGE_PUSH_EVENT} requires opportunityId`,
    );
  }

  const computed = await input.step.run("compute-target-stage", () =>
    computeOpportunityTargetStage(resolveDb(), opportunityId),
  );

  // Mode gate (§VI R-11.7): exit before ANY GHL GET or PUT when not live.
  if (!canPushGhlFactoryStage(env)) {
    console.log(
      JSON.stringify({
        tag: "katana-reverse-sync-dry-run",
        stage: computed.targetStage,
        opportunityIdPresent: true,
      }),
    );
    return {
      ok: true as const,
      dryRun: true as const,
      stage: computed.targetStage,
    };
  }

  if (computed.action === "skip") {
    return {
      ok: true as const,
      skipped: computed.reason,
      stage: computed.targetStage,
    };
  }

  // Unset target stage env is a logged skip, not a config failure (§I.1).
  if (stageIdFor(computed.targetStage, env) === null) {
    try {
      assertStageConfigDisjoint(env);
    } catch (error) {
      throw new NonRetriableError(
        error instanceof Error ? error.message : String(error),
      );
    }
    logStructured("info", "katana-reverse-sync-ghl-skip", {
      reason: "stage_unconfigured",
      stage: computed.targetStage,
    });
    return {
      ok: true as const,
      skipped: "stage_unconfigured" as const,
      stage: computed.targetStage,
    };
  }

  await input.step.run("validate-ghl-stage-config", async () => {
    try {
      assertStageConfigDisjoint(env);
    } catch (error) {
      throw new NonRetriableError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const locationId = env.GHL_LOCATION_ID?.trim() ?? "";
    if (!locationId) {
      throw new NonRetriableError(
        "GHL stage config invalid: GHL_LOCATION_ID is not configured.",
      );
    }

    const pipelinesRes = await ghlDeps.getGhl(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    );
    if (!pipelinesRes.ok) {
      rethrowGhlTransportError(new Error(pipelinesRes.error));
    }

    try {
      validateGhlStageConfigAgainstPipelines(pipelinesRes.body, env);
    } catch (error) {
      throw new NonRetriableError(
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  const moveResult = await input.step.run("push-ghl-stage", async () => {
    try {
      return await moveOpportunityStage(
        {
          opportunityId,
          targetStage: computed.targetStage,
          env,
        },
        ghlDeps,
      );
    } catch (error) {
      rethrowGhlTransportError(error);
    }
  });

  const shouldPersistStage =
    moveResult.moved || moveResult.reason === "already_at_or_past";

  await input.step.run("persist-ghl-stage", async () => {
    if (!shouldPersistStage) {
      logStructured("info", "katana-reverse-sync-ghl-skip", {
        reason: moveResult.reason,
        stage: computed.targetStage,
      });
      return;
    }

    const db = resolveDb();
    if (computed.intakeIds.length > 0) {
      await db
        .update(order_intake)
        .set({
          ghl_stage_pushed: computed.targetStage,
          ghl_stage_pushed_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .where(
          and(
            inArray(order_intake.id, computed.intakeIds),
            sql`COALESCE(CASE ${order_intake.ghl_stage_pushed} WHEN 'in_production' THEN 1 WHEN 'build_complete' THEN 2 WHEN 'ready_to_ship' THEN 3 WHEN 'delivered' THEN 4 ELSE 0 END, 0) < ${computed.targetRank}`,
          ),
        );
    }

    if (computed.jobIds.length > 0) {
      await db
        .update(custom_build_jobs)
        .set({
          ghl_stage_pushed: computed.targetStage,
          ghl_stage_pushed_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .where(
          and(
            inArray(custom_build_jobs.id, computed.jobIds),
            sql`COALESCE(CASE ${custom_build_jobs.ghl_stage_pushed} WHEN 'in_production' THEN 1 WHEN 'build_complete' THEN 2 WHEN 'ready_to_ship' THEN 3 WHEN 'delivered' THEN 4 ELSE 0 END, 0) < ${computed.targetRank}`,
          ),
        );
    }
  });

  if (shouldPersistStage && computed.hasPathARow) {
    await input.step.sendEvent("refresh-path-a-summary", {
      id: inngestEventId(
        "path-a:ghl-sync-stage",
        opportunityId,
        computed.targetStage,
      ),
      name: PATH_A_GHL_SYNC_REQUESTED_EVENT,
      data: {
        ghlOpportunityId: opportunityId,
        opportunityId,
      },
    });
  }

  return {
    ok: true as const,
    moved: moveResult.moved,
    ...(moveResult.moved ? {} : { reason: moveResult.reason }),
    stage: computed.targetStage,
  };
}

export const pushGhlFactoryStage = inngest.createFunction(
  {
    id: "push-ghl-factory-stage",
    name: "Push derived factory stage to GoHighLevel",
    triggers: [{ event: GHL_FACTORY_STAGE_PUSH_EVENT }],
    concurrency: [{ limit: 1, key: "event.data.opportunityId" }],
    throttle: { limit: 20, period: "10s" },
    retries: 4,
  },
  async ({ event, step }) =>
    runPushGhlFactoryStage({
      event: { data: event.data as Record<string, unknown> },
      step: step as unknown as PushGhlStageStepLike,
    }),
);

