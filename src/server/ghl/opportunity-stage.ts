/**
 * Phase 15 — closed-set GoHighLevel opportunity stage writer (§15.4b + §VI R-11).
 *
 * Invariants:
 *  - Zero Katana imports.
 *  - Closed-set membership via `ReadonlySet<string>.has()` only.
 *  - Monotonic forward moves within `GHL_FACTORY_PIPELINE_ID` for `open` / `won` opportunities
 *    inside `GHL_LOCATION_ID`. Never overrides Lost/Abandoned or foreign stages.
 *  - PUT body carries strictly `{ pipelineId, pipelineStageId }`.
 *  - Post-write GET detects concurrent human stage edits (`ghl-stage-race-detected`).
 */

import { logStructured } from "@/lib/log/structured";
import { FACTORY_STAGES, type FactoryStage } from "@/server/db/schema";
import {
  PRODUCE_FACTORY_ORDER_STAGE,
  factoryStageIdsFromEnv,
  wonStageIdsFromEnv,
} from "@/server/ghl/factory-stage";
import {
  asGhlRecord,
  ghlGet,
  ghlPut,
  type GhlResult,
} from "@/server/ghl/private-api";

const STAGE_RANK: Record<FactoryStage, number> = {
  in_production: 1,
  build_complete: 2,
  ready_to_ship: 3,
  delivered: 4,
};

const MOVABLE_OPPORTUNITY_STATUSES: ReadonlySet<string> = new Set(["open", "won"]);

export type GhlStageEnvMap = Record<string, string | undefined>;

export function stageIdFor(
  stage: FactoryStage,
  env: GhlStageEnvMap = process.env,
): string | null {
  let raw: string | undefined;
  switch (stage) {
    case "in_production":
      raw = env.GHL_STAGE_ID_IN_PRODUCTION;
      break;
    case "build_complete":
      raw = env.GHL_STAGE_ID_BUILD_COMPLETE;
      break;
    case "ready_to_ship":
      raw = env.GHL_STAGE_ID_READY_TO_SHIP;
      break;
    case "delivered":
      raw = env.GHL_STAGE_ID_DELIVERED;
      break;
  }
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function buildEntryStageSet(env: GhlStageEnvMap): ReadonlySet<string> {
  const set = new Set<string>();
  for (const id of factoryStageIdsFromEnv(env.GHL_FACTORY_STAGE_IDS)) {
    set.add(id);
  }
  for (const id of wonStageIdsFromEnv(env.GHL_WON_STAGE_IDS)) {
    set.add(id);
  }
  return set;
}

function configuredTargetStages(
  env: GhlStageEnvMap,
): Array<{ stage: FactoryStage; stageId: string; rank: number }> {
  const list: Array<{ stage: FactoryStage; stageId: string; rank: number }> = [];
  for (const stage of FACTORY_STAGES) {
    const id = stageIdFor(stage, env);
    if (id !== null) {
      list.push({ stage, stageId: id, rank: STAGE_RANK[stage] });
    }
  }
  return list;
}

/**
 * Verifies configured `GHL_STAGE_ID_*` values are pairwise distinct and disjoint from
 * `GHL_FACTORY_STAGE_IDS` union `GHL_WON_STAGE_IDS` (§I.1 echo-loop guard, §VI R-11.2).
 */
export function assertStageConfigDisjoint(env: GhlStageEnvMap = process.env): void {
  const entrySet = buildEntryStageSet(env);
  const seenTargets = new Set<string>();

  for (const item of configuredTargetStages(env)) {
    if (seenTargets.has(item.stageId)) {
      throw new Error(
        `GHL stage config invalid: duplicate target stage id "${item.stageId}" across GHL_STAGE_ID_* variables.`,
      );
    }
    seenTargets.add(item.stageId);

    if (entrySet.has(item.stageId)) {
      throw new Error(
        `GHL stage config invalid: ${item.stage} stage id "${item.stageId}" overlaps GHL_FACTORY_STAGE_IDS or GHL_WON_STAGE_IDS (echo-loop hazard).`,
      );
    }
  }
}

/**
 * Validates configured pipeline and target stage IDs against the live GHL `/opportunities/pipelines`
 * response (§VI R-11.2). Throws on any closed-universe or echo-name violation.
 */
export function validateGhlStageConfigAgainstPipelines(
  pipelinesPayload: unknown,
  env: GhlStageEnvMap = process.env,
): void {
  assertStageConfigDisjoint(env);

  const factoryPipelineId = env.GHL_FACTORY_PIPELINE_ID?.trim() ?? "";
  if (!factoryPipelineId) {
    throw new Error("GHL stage config invalid: GHL_FACTORY_PIPELINE_ID is not configured.");
  }

  const root = asGhlRecord(pipelinesPayload);
  const rawPipelines = Array.isArray(pipelinesPayload)
    ? pipelinesPayload
    : Array.isArray(root?.pipelines)
      ? root.pipelines
      : [];

  let matchedPipeline: Record<string, unknown> | null = null;
  for (const candidate of rawPipelines) {
    const rec = asGhlRecord(candidate);
    if (rec && typeof rec.id === "string" && rec.id.trim() === factoryPipelineId) {
      matchedPipeline = rec;
      break;
    }
  }

  if (!matchedPipeline) {
    throw new Error(
      `GHL stage config invalid: pipeline "${factoryPipelineId}" was not found in location pipelines.`,
    );
  }

  const rawStages = Array.isArray(matchedPipeline.stages) ? matchedPipeline.stages : [];
  const pipelineStages = new Map<string, string>();
  for (const rawStage of rawStages) {
    const rec = asGhlRecord(rawStage);
    const id = typeof rec?.id === "string" ? rec.id.trim() : "";
    const name = typeof rec?.name === "string" ? rec.name.trim() : "";
    if (id) {
      pipelineStages.set(id, name);
    }
  }

  const forbiddenStageName = PRODUCE_FACTORY_ORDER_STAGE.trim().toLowerCase();
  for (const item of configuredTargetStages(env)) {
    if (!pipelineStages.has(item.stageId)) {
      throw new Error(
        `GHL stage config invalid: ${item.stage} stage id "${item.stageId}" does not belong to pipeline "${factoryPipelineId}".`,
      );
    }
    const stageName = (pipelineStages.get(item.stageId) ?? "").trim().toLowerCase();
    if (stageName === forbiddenStageName) {
      throw new Error(
        `GHL stage config invalid: ${item.stage} stage id "${item.stageId}" is named "${PRODUCE_FACTORY_ORDER_STAGE}" (echo-loop hazard).`,
      );
    }
  }
}

export type MoveOpportunityStageSkipReason =
  | "stage_unconfigured"
  | "wrong_location"
  | "foreign_status"
  | "wrong_pipeline"
  | "already_at_or_past"
  | "foreign_stage";

export type MoveOpportunityStageResult =
  | {
      moved: true;
      fromStageId: string | null;
      targetStageId: string;
      raceDetected?: boolean;
    }
  | {
      moved: false;
      reason: MoveOpportunityStageSkipReason;
    };

export type MoveOpportunityStageDeps = {
  getGhl: (path: string) => Promise<GhlResult>;
  putGhl: (path: string, body: unknown) => Promise<GhlResult>;
};

function extractOpportunityRecord(body: unknown): Record<string, unknown> | null {
  const root = asGhlRecord(body);
  return asGhlRecord(root?.opportunity) ?? root;
}

export async function moveOpportunityStage(
  input: {
    opportunityId: string;
    targetStage: FactoryStage;
    env?: GhlStageEnvMap;
  },
  deps: MoveOpportunityStageDeps = { getGhl: ghlGet, putGhl: ghlPut },
): Promise<MoveOpportunityStageResult> {
  const env = input.env ?? process.env;
  assertStageConfigDisjoint(env);

  const id = input.opportunityId.trim();
  if (!id) {
    throw new Error("Opportunity id is required.");
  }

  const targetStageId = stageIdFor(input.targetStage, env);
  if (!targetStageId) {
    return { moved: false, reason: "stage_unconfigured" };
  }

  const targetRank = STAGE_RANK[input.targetStage];
  const encodedPath = `/opportunities/${encodeURIComponent(id)}`;

  const loaded = await deps.getGhl(encodedPath);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  const opportunity = extractOpportunityRecord(loaded.body);
  const expectedLocationId = (env.GHL_LOCATION_ID?.trim() || loaded.locationId || "").trim();
  const oppLocationId =
    typeof opportunity?.locationId === "string" ? opportunity.locationId.trim() : "";
  if (!expectedLocationId || !oppLocationId || oppLocationId !== expectedLocationId) {
    return { moved: false, reason: "wrong_location" };
  }

  const oppStatus =
    typeof opportunity?.status === "string" ? opportunity.status.trim().toLowerCase() : "";
  if (!MOVABLE_OPPORTUNITY_STATUSES.has(oppStatus)) {
    return { moved: false, reason: "foreign_status" };
  }

  const factoryPipelineId = env.GHL_FACTORY_PIPELINE_ID?.trim() ?? "";
  const oppPipelineId =
    typeof opportunity?.pipelineId === "string" ? opportunity.pipelineId.trim() : "";
  if (!factoryPipelineId || oppPipelineId !== factoryPipelineId) {
    return { moved: false, reason: "wrong_pipeline" };
  }

  const ourRankByStageId = new Map<string, number>();
  for (const item of configuredTargetStages(env)) {
    ourRankByStageId.set(item.stageId, item.rank);
  }
  const entrySet = buildEntryStageSet(env);

  const currentStageId =
    typeof opportunity?.pipelineStageId === "string"
      ? opportunity.pipelineStageId.trim()
      : "";

  if (ourRankByStageId.has(currentStageId)) {
    const currentRank = ourRankByStageId.get(currentStageId)!;
    if (currentRank >= targetRank) {
      return { moved: false, reason: "already_at_or_past" };
    }
  } else if (!entrySet.has(currentStageId)) {
    if (entrySet.size === 0) {
      logStructured("warn", "ghl-stage-entry-sets-empty", {
        targetStage: input.targetStage,
      });
    }
    return { moved: false, reason: "foreign_stage" };
  }

  const putResult = await deps.putGhl(encodedPath, {
    pipelineId: factoryPipelineId,
    pipelineStageId: targetStageId,
  });
  if (!putResult.ok) {
    throw new Error(putResult.error);
  }

  // Post-write verification (§VI R-11.5): detection only, never throws or loops.
  const verifyResult = await deps.getGhl(encodedPath);
  if (verifyResult.ok) {
    const afterOpp = extractOpportunityRecord(verifyResult.body);
    const afterStageId =
      typeof afterOpp?.pipelineStageId === "string"
        ? afterOpp.pipelineStageId.trim()
        : "";
    const afterStatus =
      typeof afterOpp?.status === "string" ? afterOpp.status.trim().toLowerCase() : "";
    if (afterStageId !== targetStageId || !MOVABLE_OPPORTUNITY_STATUSES.has(afterStatus)) {
      logStructured("warn", "ghl-stage-race-detected", {
        expectedStageId: targetStageId,
        observedStageId: afterStageId || null,
        observedStatus: afterStatus || null,
      });
      return {
        moved: true,
        fromStageId: currentStageId || null,
        targetStageId,
        raceDetected: true,
      };
    }
  } else {
    logStructured("warn", "ghl-stage-post-verify-unavailable", {
      targetStage: input.targetStage,
    });
  }

  return {
    moved: true,
    fromStageId: currentStageId || null,
    targetStageId,
  };
}

