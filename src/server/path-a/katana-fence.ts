/**
 * Katana Write Fence (M1: Zero Ghost Demand).
 * Blocks ANY Katana write/sync/variant creation for custom SKUs until the deal
 * has a recorded release request and is claimed by Function 2 (IN_PROGRESS or COMPLETED).
 * Pure/clean DB boundary, fails closed.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  saga_runs,
  sku_mappings,
} from "@/server/db/schema";
import { PATH_A_SAGA_TYPE } from "./saga-state";
import type { ReleaseDb } from "./release-store";

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
  resolveDb: () => ReleaseDb = getDb,
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

  const attrs = mapping?.attributes as Record<string, unknown> | undefined;
  const isCustom = Boolean(attrs?.custom_build) || sku.startsWith("JOB-");

  if (!isCustom) {
    return { type: "not_custom" };
  }

  const jobId = typeof attrs?.job_id === "string" ? attrs.job_id : undefined;
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
  resolveDb: () => ReleaseDb = getDb,
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
  } catch (err: unknown) {
    if (err instanceof PathAFenceError) {
      throw err;
    }
    // Check for Postgres 42P01 (undefined_table) or 42703 (undefined_column)
    if (isMissingRelationError(err)) {
      throw new PathAFenceError(
        `Migration 0055 schema missing on database host. Failing closed for custom SKU ${globalSku}.`,
        "PATH_A_SCHEMA_MISSING",
      );
    }
    throw err;
  }
}

function isMissingRelationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown; message?: unknown };
  const cause = e.cause && typeof e.cause === "object" ? (e.cause as { code?: unknown }) : undefined;
  const code = typeof e.code === "string" ? e.code : typeof cause?.code === "string" ? cause.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes("42P01") ||
    message.includes("42703")
  );
}

/**
 * Fences a whole SKU list (e.g. every row of one Katana Sales Order). The list
 * is blocked if ANY custom SKU in it is not yet claimed for release.
 * SKUs are normalised and de-duplicated; each is checked via assertKatanaWriteAllowed.
 */
export async function assertKatanaWriteAllowedForSkus(
  skus: readonly string[],
  resolveDb: () => ReleaseDb = getDb,
): Promise<void> {
  const unique = [...new Set(skus.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  for (const sku of unique) {
    await assertKatanaWriteAllowed(sku, resolveDb);
  }
}

/**
 * Fences Katana write operations addressed by Sales Order ROW id (Make-to-Order MO
 * creation). Each row id is resolved to the custom item that owns it
 * (custom_build_job_items.katana_sales_order_row_id) and that SKU is fenced.
 * Rows no custom item owns (catalog / Woo orders) pass. A missing items table
 * (42P01/42703) fails closed (D4). Any other DB error propagates.
 */
export async function assertKatanaWriteAllowedForSalesOrderRows(
  rowIds: readonly number[],
  resolveDb: () => ReleaseDb = getDb,
): Promise<void> {
  const owners: string[] = [];
  for (const rowId of [...new Set(rowIds)]) {
    let owner: { global_sku: string } | undefined;
    try {
      const db = resolveDb();
      const rows = await db
        .select({ global_sku: custom_build_job_items.global_sku })
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.katana_sales_order_row_id, rowId))
        .limit(1);
      owner = rows[0];
    } catch (err: unknown) {
      if (isMissingRelationError(err)) {
        throw new PathAFenceError(
          `Migration 0055 schema missing on database host. Failing closed for sales order rows.`,
          "PATH_A_SCHEMA_MISSING",
        );
      }
      throw err;
    }
    if (owner?.global_sku) {
      owners.push(owner.global_sku);
    }
  }
  await assertKatanaWriteAllowedForSkus(owners, resolveDb);
}
