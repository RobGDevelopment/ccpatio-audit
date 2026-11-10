/**
 * Phase 15b — Factory Airlock job release decision & DB state loader.
 *
 * Pure decision (`decideAirlockRelease`) plus a hub DB query (`loadJobAirlockState`).
 * Zero Katana imports, zero QBO imports, zero concurrency primitives.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  factory_airlock_builds,
  type FactoryAirlockStatus,
} from "@/server/db/schema";
import type { ReleaseDb } from "./release-store";

export type JobAirlockItemState = {
  itemId: string;
  buildId: string | null;
  status: FactoryAirlockStatus | null;
};

export type JobAirlockState = {
  items: JobAirlockItemState[];
};

export type AirlockReleaseDecision =
  | { kind: "release" }
  | { kind: "waiting"; unapprovedItemIds: string[] }
  | { kind: "already_pushed" };

export async function loadJobAirlockState(
  jobId: string,
  db: ReleaseDb = getDb(),
): Promise<JobAirlockState> {
  const rows = await db
    .select({
      itemId: custom_build_job_items.id,
      buildId: factory_airlock_builds.id,
      status: factory_airlock_builds.status,
    })
    .from(custom_build_job_items)
    .leftJoin(
      factory_airlock_builds,
      eq(factory_airlock_builds.job_item_id, custom_build_job_items.id),
    )
    .where(eq(custom_build_job_items.job_id, jobId))
    .orderBy(asc(custom_build_job_items.created_at), asc(custom_build_job_items.id));

  return {
    items: rows.map((row) => ({
      itemId: row.itemId,
      buildId: row.buildId ?? null,
      status: row.status ?? null,
    })),
  };
}

/**
 * OD-1: Release requires EVERY item on the job to have a build in `approved` or `pushed`
 * AND at least one item in `approved`. An item without a build (or an empty item list)
 * blocks release (fail closed).
 */
export function decideAirlockRelease(
  state: JobAirlockState,
): AirlockReleaseDecision {
  if (state.items.length === 0) {
    return { kind: "waiting", unapprovedItemIds: [] };
  }

  const unapprovedItemIds: string[] = [];
  let hasApproved = false;

  for (const item of state.items) {
    if (
      !item.buildId ||
      (item.status !== "approved" && item.status !== "pushed")
    ) {
      unapprovedItemIds.push(item.itemId);
      continue;
    }
    if (item.status === "approved") {
      hasApproved = true;
    }
  }

  if (unapprovedItemIds.length > 0) {
    return { kind: "waiting", unapprovedItemIds };
  }

  if (hasApproved) {
    return { kind: "release" };
  }

  return { kind: "already_pushed" };
}

