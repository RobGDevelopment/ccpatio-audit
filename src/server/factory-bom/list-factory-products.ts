import { and, asc, eq, like } from "drizzle-orm";
import { subAssemblySku } from "@/lib/heuristic-bom";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  product_bom,
  product_bom_draft,
  sku_mappings,
  type RecipeReviewStatus,
} from "@/server/db/schema";

export type FactoryProductRow = {
  sku: string;
  name: string;
  collection: string;
  phaseSource: string;
  length: string | null;
  depth: string | null;
  height: string | null;
  msrp: string | null;
  reviewStatus: RecipeReviewStatus | "none";
  liveBom: boolean;
  draftLineCount: number;
};

function rollupStatus(statuses: RecipeReviewStatus[]): RecipeReviewStatus | "none" {
  if (statuses.length === 0) return "none";
  if (statuses.some((status) => status === "edited")) return "edited";
  if (statuses.every((status) => status === "factory_approved")) return "factory_approved";
  if (statuses.some((status) => status === "draft_pending_review")) {
    return "draft_pending_review";
  }
  return statuses[0] ?? "none";
}

function subAsm(finSku: string, role: "FRAME" | "CUSH"): string {
  return subAssemblySku(finSku, role);
}

function legacySubAsm(finSku: string, role: "FRAME" | "CUSH"): string {
  return `SA-${finSku.replace(/^FIN-/i, "").toUpperCase()}-${role}`;
}

export async function listFactoryProducts(): Promise<FactoryProductRow[]> {
  const db = getDb();
  const mappings = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      collection: sku_mappings.category,
      phaseSource: sku_mappings.source_file,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      msrp: finished_goods_catalog.msrp,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(
      and(
        eq(sku_mappings.item_type, "finished_good"),
        like(sku_mappings.source_file, "vividworks_phase%"),
      ),
    )
    .orderBy(asc(sku_mappings.category), asc(sku_mappings.global_sku));

  if (mappings.length === 0) return [];

  const draftParents = await db
    .select({
      parent: product_bom_draft.parent_sku,
      status: product_bom_draft.status,
    })
    .from(product_bom_draft);

  const liveParents = await db
    .selectDistinct({ parent: product_bom.parent_sku })
    .from(product_bom);

  const liveSet = new Set(liveParents.map((row) => row.parent));
  const statusByParent = new Map<string, RecipeReviewStatus[]>();
  const countByParent = new Map<string, number>();
  for (const row of draftParents) {
    const list = statusByParent.get(row.parent) ?? [];
    list.push(row.status);
    statusByParent.set(row.parent, list);
    countByParent.set(row.parent, (countByParent.get(row.parent) ?? 0) + 1);
  }

  return mappings.map((row) => {
    const relatedStatuses = [
      ...(statusByParent.get(row.sku) ?? []),
      ...(statusByParent.get(subAsm(row.sku, "FRAME")) ?? []),
      ...(statusByParent.get(legacySubAsm(row.sku, "FRAME")) ?? []),
      ...(statusByParent.get(subAsm(row.sku, "CUSH")) ?? []),
      ...(statusByParent.get(legacySubAsm(row.sku, "CUSH")) ?? []),
    ];
    const draftCount =
      (countByParent.get(row.sku) ?? 0) +
      (countByParent.get(subAsm(row.sku, "FRAME")) ?? 0) +
      (countByParent.get(legacySubAsm(row.sku, "FRAME")) ?? 0) +
      (countByParent.get(subAsm(row.sku, "CUSH")) ?? 0) +
      (countByParent.get(legacySubAsm(row.sku, "CUSH")) ?? 0);

    return {
      sku: row.sku,
      name: row.name,
      collection: row.collection,
      phaseSource: row.phaseSource,
      length: row.length,
      depth: row.depth,
      height: row.height,
      msrp: row.msrp,
      reviewStatus: rollupStatus(relatedStatuses),
      liveBom: liveSet.has(row.sku),
      draftLineCount: draftCount,
    };
  });
}
