/**
 * Katana Write Fence (M1: Zero Ghost Demand).
 * Blocks ANY Katana write/sync/variant creation for custom SKUs until the deal
 * has a recorded release request and is claimed by Function 2 (IN_PROGRESS or COMPLETED).
 * Pure/clean DB boundary, fails closed.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_jobs,
  saga_runs,
  sku_mappings,
} from "@/server/db/schema";
import { PATH_A_SAGA_TYPE } from "./saga-state";

export class PathAFenceError extends Error {
  public readonly code: string;
  constructor(message: string, code: string = "PATH_A_FENCE_BLOCKED") {
    super(message);
    this.name = "PathAFenceError";
    this.code = code;
  }
}

export type SkuCustomClassification =
  | { type: "not_custom" }
  | { type: "custom_without_opportunity"; jobId?: string | null }
  | { type: "custom_job_bound"; jobId: string; opportunityId: string };

/**
 * Classifies a SKU to determine if it is subject to the Path A Katana write fence.
 */
export async function classifyCustomSku(
  globalSku: string,
  resolveDb: () => any = getDb,
): Promise<SkuCustomClassification> {
  const db = resolveDb();
  const sku = globalSku.trim().toUpperCase();

  const [mapping] = await db
    .select({
      global_sku: sku_mappings.global_sku,
      attributes: sku_mappings.attributes,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  const attrs = mapping?.attributes as Record<string, any> | undefined;
  const isCustom = Boolean(attrs?.custom_build) || sku.startsWith("JOB-");

  if (!isCustom) {
    return { type: "not_custom" };
  }

  const jobId = attrs?.job_id;
  if (!jobId) {
    return { type: "custom_without_opportunity", jobId: null };
  }

  const [job] = await db
    .select({
      id: custom_build_jobs.id,
      ghl_opportunity_id: custom_build_jobs.ghl_opportunity_id,
    })
    .from(custom_build_jobs)
    .where(eq(custom_build_jobs.id, jobId))
    .limit(1);

  if (!job || !job.ghl_opportunity_id) {
    return { type: "custom_without_opportunity", jobId: job?.id ?? jobId };
  }

  return {
    type: "custom_job_bound",
    jobId: job.id,
    opportunityId: job.ghl_opportunity_id,
  };
}

/**
 * Asserts that a Katana write is permitted for this SKU.
 * Non-custom SKUs pass without DB reads beyond the classification.
 * Custom SKUs pass ONLY if the bound opportunity's saga is IN_PROGRESS or COMPLETED
 * with a valid release request.
 * Throws PathAFenceError (fail closed).
 */
export async function assertKatanaWriteAllowed(
  globalSku: string,
  resolveDb: () => any = getDb,
): Promise<void> {
  try {
    const classification = await classifyCustomSku(globalSku, resolveDb);

    if (classification.type === "not_custom") {
      return;
    }

    if (classification.type === "custom_without_opportunity") {
      throw new PathAFenceError(
        `SKU ${globalSku} is a custom build with no GHL opportunity attached. Attach a GHL opportunity before releasing to production.`,
        "PATH_A_CUSTOM_NO_OPPORTUNITY",
      );
    }

    const db = resolveDb();
    const [row] = await db
      .select({
        status: saga_runs.status,
        release_requested_at: saga_runs.release_requested_at,
      })
      .from(saga_runs)
      .where(
        and(
          eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
          eq(saga_runs.correlation_key, classification.opportunityId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new PathAFenceError(
        `SKU ${globalSku} has no saga row for opportunity ${classification.opportunityId}. Zero ghost demand: pre-release Katana writes are blocked.`,
        "PATH_A_NO_SAGA",
      );
    }

    const isLegalStatus = row.status === "IN_PROGRESS" || row.status === "COMPLETED";
    const hasRequest = Boolean(row.release_requested_at);

    if (!isLegalStatus || !hasRequest) {
      throw new PathAFenceError(
        `SKU ${globalSku} belongs to opportunity ${classification.opportunityId} in status "${row.status}" (release_requested=${hasRequest}). Katana writes are blocked until claimed for release.`,
        "PATH_A_FENCE_BLOCKED",
      );
    }
  } catch (err: any) {
    if (err instanceof PathAFenceError) {
      throw err;
    }
    // Check for Postgres 42P01 (undefined_table) or 42703 (undefined_column)
    const code = err?.code || err?.cause?.code;
    if (
      code === "42P01" ||
      code === "42703" ||
      String(err?.message).includes("42P01") ||
      String(err?.message).includes("42703")
    ) {
      throw new PathAFenceError(
        `Migration 0055 schema missing on database host (${code}). Failing closed for custom SKU ${globalSku}.`,
        "PATH_A_SCHEMA_MISSING",
      );
    }
    throw err;
  }
}
