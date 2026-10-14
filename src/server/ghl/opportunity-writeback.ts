/**
 * GHL Opportunity Write-back Service (Task 8).
 * Builds custom build summary and syncs to GHL via custom field or contact note.
 * ZERO Katana imports.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  product_bom,
  saga_runs,
} from "@/server/db/schema";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";
import {
  buildGhlOpportunitySummary,
  type GhlSummaryBomLine,
  type GhlSummaryInput,
  type GhlSummaryItem,
} from "@/server/path-a/ghl-summary";
import { asGhlRecord, ghlGet, ghlPost, ghlPut } from "./private-api";

/** The drizzle handle type; tests inject a table-aware fake cast to this. */
export type WritebackDb = ReturnType<typeof getDb>;

export type GhlSyncMode = "log" | "live";

export function getPathAGhlSyncMode(): GhlSyncMode {
  return process.env.PATH_A_GHL_SYNC_MODE?.trim().toLowerCase() === "live"
    ? "live"
    : "log";
}

export function getGhlOpportunityBuildSummaryFieldId(): string {
  return process.env.GHL_OPPORTUNITY_BUILD_SUMMARY_FIELD_ID?.trim() || "";
}

export type GhlWritebackDeps = {
  db?: WritebackDb;
  getGhl?: typeof ghlGet;
  putGhl?: typeof ghlPut;
  postGhl?: typeof ghlPost;
  getSyncMode?: () => GhlSyncMode;
  getFieldId?: () => string;
};

export async function loadOpportunitySummaryData(
  opportunityId: string,
  db: WritebackDb = getDb(),
): Promise<{ input: GhlSummaryInput; currentHash: string | null } | null> {
  const [job] = await db
    .select({
      id: custom_build_jobs.id,
      displayName: custom_build_jobs.display_name,
      katanaOrderNo: custom_build_jobs.katana_order_no,
      katanaMoIds: custom_build_jobs.katana_mo_ids,
      ghlSyncHash: custom_build_jobs.ghl_sync_hash,
    })
    .from(custom_build_jobs)
    .where(eq(custom_build_jobs.ghl_opportunity_id, opportunityId))
    .limit(1);

  if (!job) return null;

  const [saga] = await db
    .select({
      status: saga_runs.status,
    })
    .from(saga_runs)
    .where(
      and(
        eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
        eq(saga_runs.correlation_key, opportunityId),
      ),
    )
    .limit(1);

  const items: Array<typeof custom_build_job_items.$inferSelect> = await db
    .select()
    .from(custom_build_job_items)
    .where(eq(custom_build_job_items.job_id, job.id));

  const itemSummaries: GhlSummaryItem[] = [];
  for (const item of items) {
    let bomLines: GhlSummaryBomLine[] = [];
    // design_status is the real column (there is no `status` on custom_build_job_items).
    if (item.design_status === "finalized" || item.design_status === "released") {
      const lines = await db
        .select({
          childSku: product_bom.child_sku,
          quantity: product_bom.quantity,
          unitOfMeasure: product_bom.unit_of_measure,
        })
        .from(product_bom)
        .where(eq(product_bom.parent_sku, item.global_sku));
      bomLines = lines;
    }
    itemSummaries.push({
      globalSku: item.global_sku,
      quantity: Number(item.quantity),
      status: item.design_status,
      finalizedDossierHash: item.finalized_dossier_hash,
      bomLines,
    });
  }

  const input: GhlSummaryInput = {
    opportunityId,
    opportunityName: job.displayName,
    sagaStatus: saga?.status ?? "PENDING",
    katanaOrderNo: job.katanaOrderNo,
    katanaMoIds: Array.isArray(job.katanaMoIds)
      ? job.katanaMoIds.filter((id): id is number => typeof id === "number")
      : null,
    items: itemSummaries,
    // Configuration only: no hard-coded production host (the summary omits the link without it).
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined,
  };

  return { input, currentHash: job.ghlSyncHash };
}

export type SyncGhlResult =
  | { ok: true; contentHash: string; skipped?: boolean; reason?: string; dryRun?: boolean }
  | { ok: false; error: string };

export async function syncOpportunitySummaryToGhl(
  opportunityId: string,
  deps: GhlWritebackDeps = {},
): Promise<SyncGhlResult> {
  const db = deps.db ?? getDb();
  const getFn = deps.getGhl ?? ghlGet;
  const putFn = deps.putGhl ?? ghlPut;
  const postFn = deps.postGhl ?? ghlPost;
  const getModeFn = deps.getSyncMode ?? getPathAGhlSyncMode;
  const getFieldIdFn = deps.getFieldId ?? getGhlOpportunityBuildSummaryFieldId;

  const data = await loadOpportunitySummaryData(opportunityId, db);
  if (!data) {
    return { ok: false, error: `No custom build job found for opportunity ${opportunityId}` };
  }

  const summary = buildGhlOpportunitySummary(data.input);
  const contentHash = crypto.createHash("sha256").update(summary).digest("hex");

  // Idempotency: skip if already synced with identical content
  if (data.currentHash && data.currentHash === contentHash) {
    return { ok: true, contentHash, skipped: true, reason: "hash_unchanged" };
  }

  const mode = getModeFn();
  if (mode !== "live") {
    console.log(
      JSON.stringify({
        tag: "path-a-ghl-sync-dry-run",
        opportunityId,
        length: summary.length,
        contentHash: contentHash.slice(0, 16),
      }),
    );
    return { ok: true, contentHash, dryRun: true };
  }

  const fieldId = getFieldIdFn();
  if (fieldId) {
    // Primary channel: update opportunity custom field
    const res = await putFn(`/opportunities/${encodeURIComponent(opportunityId)}`, {
      customFields: [{ id: fieldId, field_value: summary }],
    });
    if (!res.ok) {
      throw new Error(`GHL Opportunity custom field update failed: ${res.error}`);
    }
  } else {
    // Fallback channel: contact note
    const oppRes = await getFn(`/opportunities/${encodeURIComponent(opportunityId)}`);
    if (!oppRes.ok) {
      throw new Error(`GHL Opportunity lookup failed: ${oppRes.error}`);
    }
    const oppBody = asGhlRecord(oppRes.body);
    const oppRecord = asGhlRecord(oppBody?.opportunity) ?? oppBody;
    const nestedContactId = asGhlRecord(oppRecord?.contact)?.id;
    const rawContactId = oppRecord?.contactId || nestedContactId;
    const contactId = typeof rawContactId === "string" ? rawContactId.trim() : "";
    if (!contactId) {
      throw new Error(`GHL Opportunity has no attached contactId for note creation`);
    }

    const noteRes = await postFn(`/contacts/${encodeURIComponent(contactId)}/notes`, {
      body: summary,
    });
    if (!noteRes.ok) {
      throw new Error(`GHL contact note creation failed: ${noteRes.error}`);
    }
  }

  // Persist hash on success
  await db
    .update(custom_build_jobs)
    .set({
      ghl_sync_hash: contentHash,
      ghl_synced_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(custom_build_jobs.ghl_opportunity_id, opportunityId));

  return { ok: true, contentHash, dryRun: false };
}
