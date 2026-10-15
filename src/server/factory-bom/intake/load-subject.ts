import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_jobs,
  custom_build_job_items,
  finished_goods_catalog,
  sku_mappings,
} from "@/server/db/schema";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";

export type IntakeSubject = FactoryProductRow & {
  sourceFile: string;
  category: string;
  itemType: string;
  jobId?: string | null;
  opportunityId?: string | null;
  finishes?: unknown;
  packet?: unknown;
  quantity?: number;
  customBuild?: boolean;
};

export async function loadIntakeSubject(sku: string): Promise<IntakeSubject | null> {
  const db = getDb();
  const mapping = await db.query.sku_mappings.findFirst({
    where: eq(sku_mappings.global_sku, sku),
  });

  if (!mapping) return null;

  const catalogRow = await db.query.finished_goods_catalog.findFirst({
    where: eq(finished_goods_catalog.global_sku, sku),
  });

  const attrs = (mapping.attributes || {}) as Record<string, unknown>;
  const jobId = typeof attrs.job_id === "string" ? attrs.job_id : null;

  let jobRow: typeof custom_build_jobs.$inferSelect | undefined;
  let itemRow: typeof custom_build_job_items.$inferSelect | undefined;

  if (jobId) {
    jobRow = await db.query.custom_build_jobs.findFirst({
      where: eq(custom_build_jobs.id, jobId),
    });
    itemRow = await db.query.custom_build_job_items.findFirst({
      where: eq(custom_build_job_items.global_sku, sku),
    });
  }

  const name = mapping.original_name || catalogRow?.description || sku;

  return {
    sku: mapping.global_sku,
    name,
    collection: mapping.category || "Custom",
    phaseSource: mapping.source_file || "factory-bom-intake",
    length: catalogRow?.length || null,
    depth: catalogRow?.depth || null,
    height: catalogRow?.height || null,
    msrp: catalogRow?.msrp || null,
    reviewStatus: "none",
    liveBom: false,
    draftLineCount: 0,
    sourceFile: mapping.source_file || "factory-bom-intake",
    category: mapping.category || "Custom",
    itemType: mapping.item_type || "finished_good",
    jobId: jobId || undefined,
    opportunityId: jobRow?.ghl_opportunity_id || undefined,
    finishes: attrs.finishes || undefined,
    packet: (attrs.intake as Record<string, unknown> | undefined)?.packet || undefined,
    quantity: itemRow?.quantity ?? 1,
    customBuild: Boolean(attrs.custom_build),
  };
}
