"use server";

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  searchBomMaterials,
  type BomComponentCandidate,
  type BomMutationResult,
  type BomTreeNode,
} from "@/app/admin/dictionary/actions";
import { CAD_UPLOADED_EVENT } from "@/lib/cad-upload";
import { processCadUploadJob } from "@/lib/cad-upload/process-job";
import { getPimSession, logPimAudit } from "@/lib/pim-audit";
import { syncBOMToKatana } from "@/lib/katana";
import { runSecondaryExtract } from "@/lib/secondary-extraction";
import { splitBomNotes } from "@/lib/sketchup-cutlist";
import { inngest } from "@/inngest/client";
import {
  CAD_MAX_BYTES,
  createCadSignedUpload,
  uploadProductImage,
} from "@/lib/supabase-storage";
import { getDb } from "@/server/db/client";
import {
  cad_uploads,
  finished_goods_catalog,
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  recipe_estimates_draft,
  sku_mappings,
  type CadUploadStatus,
  type ItemType,
  type RecipeReviewStatus,
} from "@/server/db/schema";

export type { BomComponentCandidate, BomTreeNode };

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

export type RecipeEstimateOverrides = {
  weightLbs?: number;
  dimWeightLbs?: number;
  laborMinutes?: number;
  includePackagingBom?: boolean;
  applyEstimatedWeight?: boolean;
};

export type RecipeEstimateRow = {
  rootSku: string;
  estWeightLbs: string | null;
  weightBreakdown: Record<string, number>;
  estDimWeightLbs: string | null;
  cartonLwhIn: { l: number; w: number; h: number } | null;
  packagingBom: Record<string, unknown> | null;
  estLaborMinutes: string | null;
  laborBreakdown: Record<string, unknown>;
  estPackagingCost: string | null;
  overrides: RecipeEstimateOverrides;
  status: RecipeReviewStatus;
  source: string;
  calcVersion: string;
  inputsHash: string | null;
};

export type DraftBomLine = {
  id: string;
  parentSku: string;
  childSku: string;
  childName: string;
  childItemType: ItemType;
  quantity: string;
  scrapFactor: string;
  unitOfMeasure: string;
  status: RecipeReviewStatus;
  source: string;
  notes: string | null;
};

const BOM_UNITS = new Set([
  "in",
  "yd",
  "ea",
  "lbs",
  "lb",
  "ft",
  "sqft",
  "oz",
  "gal",
  "boardft",
  "slab",
]);

const PRODUCIBLE: ItemType[] = ["finished_good", "sub_assembly"];
const CHILD_ALLOWED: ItemType[] = ["raw_material", "sub_assembly"];

function revalidateFactory(): void {
  try {
    revalidatePath("/admin/factory-bom");
    revalidatePath("/admin/dictionary");
  } catch {
    // vitest / scripts
  }
}

function parseQuantity(raw: string): string | null {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(4);
}

async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await getPimSession();
  if (!session) return { error: "Sign in required" };
  return { email: session.email };
}

function rollupStatus(statuses: RecipeReviewStatus[]): RecipeReviewStatus | "none" {
  if (statuses.length === 0) return "none";
  if (statuses.some((s) => s === "edited")) return "edited";
  if (statuses.every((s) => s === "factory_approved")) return "factory_approved";
  if (statuses.some((s) => s === "draft_pending_review")) {
    return "draft_pending_review";
  }
  return statuses[0] ?? "none";
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
      ...(statusByParent.get(subAsm(row.sku, "CUSH")) ?? []),
    ];
    const draftCount =
      (countByParent.get(row.sku) ?? 0) +
      (countByParent.get(subAsm(row.sku, "FRAME")) ?? 0) +
      (countByParent.get(subAsm(row.sku, "CUSH")) ?? 0);

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

function subAsm(finSku: string, role: "FRAME" | "CUSH"): string {
  return `SA-${finSku.replace(/^FIN-/, "")}-${role}`;
}

export async function getDraftBomTree(
  rootSku: string,
): Promise<BomTreeNode | null> {
  const root = rootSku.trim().toUpperCase();
  if (!root) return null;
  const db = getDb();
  const [rootMapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, root))
    .limit(1);
  if (!rootMapping) return null;

  async function build(
    sku: string,
    depth: number,
    stack: Set<string>,
  ): Promise<BomTreeNode> {
    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    const lines = await db
      .select()
      .from(product_bom_draft)
      .where(eq(product_bom_draft.parent_sku, sku))
      .orderBy(asc(product_bom_draft.child_sku));

    const children: BomTreeNode[] = [];
    if (!stack.has(sku) && depth < 12) {
      const nextStack = new Set(stack);
      nextStack.add(sku);
      for (const line of lines) {
        const childNode = await build(line.child_sku, depth + 1, nextStack);
        children.push({
          ...childNode,
          lineId: line.id,
          quantity: line.quantity,
          scrapFactor: line.scrap_factor,
          unitOfMeasure: line.unit_of_measure,
        });
      }
    }

    return {
      sku,
      name: mapping?.original_name ?? sku,
      itemType: mapping?.item_type ?? "raw_material",
      depth,
      lineId: null,
      quantity: null,
      scrapFactor: null,
      unitOfMeasure: null,
      children,
    };
  }

  return build(root, 0, new Set());
}

export async function listDraftLinesForParent(
  parentSku: string,
): Promise<DraftBomLine[]> {
  const sku = parentSku.trim().toUpperCase();
  if (!sku) return [];
  const db = getDb();
  const rows = await db
    .select({
      line: product_bom_draft,
      childType: sku_mappings.item_type,
      childName: sku_mappings.original_name,
    })
    .from(product_bom_draft)
    .leftJoin(sku_mappings, eq(product_bom_draft.child_sku, sku_mappings.global_sku))
    .where(eq(product_bom_draft.parent_sku, sku))
    .orderBy(asc(product_bom_draft.child_sku));

  return rows.map((row) => ({
    id: row.line.id,
    parentSku: row.line.parent_sku,
    childSku: row.line.child_sku,
    childName: row.childName ?? row.line.child_sku,
    childItemType: row.childType ?? "raw_material",
    quantity: row.line.quantity,
    scrapFactor: row.line.scrap_factor,
    unitOfMeasure: row.line.unit_of_measure,
    status: row.line.status,
    source: row.line.source,
    notes: row.line.notes,
  }));
}

export async function searchFactoryMaterials(
  query: string,
): Promise<BomComponentCandidate[]> {
  return searchBomMaterials(query);
}

async function wouldCreateDraftCycle(
  parentSku: string,
  childSku: string,
): Promise<boolean> {
  if (parentSku === childSku) return true;
  const db = getDb();
  const visited = new Set<string>();
  const queue = [childSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentSku) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const kids = await db
      .select({ child: product_bom_draft.child_sku })
      .from(product_bom_draft)
      .where(eq(product_bom_draft.parent_sku, current));
    for (const k of kids) queue.push(k.child);
  }
  return false;
}

export async function upsertDraftBomLine(data: {
  id?: string;
  parentSku: string;
  childSku: string;
  quantity: string;
  scrapFactor?: string;
  unitOfMeasure: string;
  notes?: string | null;
}): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  try {
    const parentSku = data.parentSku.trim().toUpperCase();
    const childSku = data.childSku.trim().toUpperCase();
    const quantity = parseQuantity(data.quantity);
    const scrapFactor = parseQuantity(data.scrapFactor ?? "1") ?? "1.0000";
    const unitOfMeasure = data.unitOfMeasure.trim().toLowerCase();
    const notes =
      data.notes === undefined
        ? undefined
        : data.notes === null
          ? null
          : data.notes.trim() || null;

    if (!parentSku || !childSku) {
      return { ok: false, error: "parent_sku and child_sku are required" };
    }
    if (!quantity) return { ok: false, error: "quantity must be a positive number" };
    if (!BOM_UNITS.has(unitOfMeasure)) {
      return { ok: false, error: "Unsupported unit of measure" };
    }

    const db = getDb();
    const [parent] = await db
      .select({ item_type: sku_mappings.item_type })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, parentSku))
      .limit(1);
    const [child] = await db
      .select({ item_type: sku_mappings.item_type })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, childSku))
      .limit(1);
    if (!parent) return { ok: false, error: `Parent SKU not found: ${parentSku}` };
    if (!child) return { ok: false, error: `Child SKU not found: ${childSku}` };
    if (!PRODUCIBLE.includes(parent.item_type)) {
      return { ok: false, error: "Parent must be finished_good or sub_assembly" };
    }
    if (!CHILD_ALLOWED.includes(child.item_type)) {
      return { ok: false, error: "Child must be raw_material or sub_assembly" };
    }
    if (await wouldCreateDraftCycle(parentSku, childSku)) {
      return { ok: false, error: "That link would create a BOM cycle" };
    }

    const now = new Date();
    if (data.id) {
      const [updated] = await db
        .update(product_bom_draft)
        .set({
          child_sku: childSku,
          quantity,
          scrap_factor: scrapFactor,
          unit_of_measure: unitOfMeasure,
          ...(notes !== undefined ? { notes } : {}),
          status: "edited",
          source: "manager",
          updated_at: now,
        })
        .where(eq(product_bom_draft.id, data.id))
        .returning({ id: product_bom_draft.id });
      if (!updated) return { ok: false, error: "Draft line not found" };
    } else {
      await db.insert(product_bom_draft).values({
        parent_sku: parentSku,
        child_sku: childSku,
        quantity,
        scrap_factor: scrapFactor,
        unit_of_measure: unitOfMeasure,
        notes: notes ?? null,
        status: "edited",
        source: "manager",
        updated_at: now,
      });
    }

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: parentSku,
      action: "factory_bom_draft_upsert",
      field: childSku,
      newValue: quantity,
    });
    revalidateFactory();
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Draft save failed";
    if (message.includes("duplicate key") || message.includes("23505")) {
      return { ok: false, error: "This material is already in the draft recipe." };
    }
    return { ok: false, error: message };
  }
}

export async function deleteDraftBomLine(id: string): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };
  const lineId = id.trim();
  if (!lineId) return { ok: false, error: "id is required" };
  const db = getDb();
  const [deleted] = await db
    .delete(product_bom_draft)
    .where(eq(product_bom_draft.id, lineId))
    .returning({ parent: product_bom_draft.parent_sku });
  if (!deleted) return { ok: false, error: "Draft line not found" };
  await logPimAudit({
    operatorEmail: session.email,
    globalSku: deleted.parent,
    action: "factory_bom_draft_delete",
  });
  revalidateFactory();
  return { ok: true };
}

export type DraftOperationRow = {
  id: string;
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins: string | null;
  runTimeMins: string | null;
  status: RecipeReviewStatus;
  source: string;
};

export type UpsertDraftOperationInput = {
  id?: string;
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins?: string;
  runTimeMins?: string;
};

function mapDraftOperationRow(
  row: typeof item_operations_draft.$inferSelect,
): DraftOperationRow {
  return {
    id: row.id,
    itemSku: row.item_sku,
    workCenter: row.work_center,
    sequence: row.sequence,
    setupTimeMins: row.setup_time_mins,
    runTimeMins: row.run_time_mins,
    status: row.status,
    source: row.source,
  };
}

export async function listDraftOperations(
  itemSku: string,
): Promise<DraftOperationRow[]> {
  const sku = itemSku.trim().toUpperCase();
  if (!sku) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(item_operations_draft)
    .where(eq(item_operations_draft.item_sku, sku))
    .orderBy(
      asc(item_operations_draft.sequence),
      asc(item_operations_draft.work_center),
    );
  return rows.map(mapDraftOperationRow);
}

export async function upsertDraftOperation(
  data: UpsertDraftOperationInput,
): Promise<{ ok: true; row: DraftOperationRow } | { ok: false; error: string }> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  try {
    const itemSku = data.itemSku.trim().toUpperCase();
    const workCenter = data.workCenter.trim();
    const sequence = Number(data.sequence);
    const setup = data.setupTimeMins?.trim()
      ? parseQuantity(data.setupTimeMins)
      : null;
    const run = data.runTimeMins?.trim()
      ? parseQuantity(data.runTimeMins)
      : null;

    if (!itemSku) return { ok: false, error: "item_sku is required" };
    if (!workCenter) return { ok: false, error: "work_center is required" };
    if (!Number.isFinite(sequence) || sequence < 0) {
      return { ok: false, error: "sequence must be a non-negative integer" };
    }
    if (data.setupTimeMins?.trim() && !setup) {
      return { ok: false, error: "setup_time_mins must be a positive number" };
    }
    if (data.runTimeMins?.trim() && !run) {
      return { ok: false, error: "run_time_mins must be a positive number" };
    }

    const db = getDb();
    const [parent] = await db
      .select({ item_type: sku_mappings.item_type })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, itemSku))
      .limit(1);
    if (!parent) return { ok: false, error: `SKU not found: ${itemSku}` };
    if (!PRODUCIBLE.includes(parent.item_type)) {
      return {
        ok: false,
        error: "Routings only apply to finished_good or sub_assembly",
      };
    }

    const now = new Date();
    if (data.id) {
      const [updated] = await db
        .update(item_operations_draft)
        .set({
          work_center: workCenter,
          sequence: Math.trunc(sequence),
          setup_time_mins: setup,
          run_time_mins: run,
          status: "edited",
          source: "manager",
          updated_at: now,
        })
        .where(eq(item_operations_draft.id, data.id))
        .returning();
      if (!updated) return { ok: false, error: "Operation not found" };
      await logPimAudit({
        operatorEmail: session.email,
        globalSku: itemSku,
        action: "factory_bom_draft_op_upsert",
        field: workCenter,
        newValue: String(Math.trunc(sequence)),
      });
      revalidateFactory();
      return { ok: true, row: mapDraftOperationRow(updated) };
    }

    const [inserted] = await db
      .insert(item_operations_draft)
      .values({
        item_sku: itemSku,
        work_center: workCenter,
        sequence: Math.trunc(sequence),
        setup_time_mins: setup,
        run_time_mins: run,
        status: "edited",
        source: "manager",
        updated_at: now,
      })
      .returning();

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: itemSku,
      action: "factory_bom_draft_op_upsert",
      field: workCenter,
      newValue: String(Math.trunc(sequence)),
    });
    revalidateFactory();
    return { ok: true, row: mapDraftOperationRow(inserted) };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown operation save failure";
    return { ok: false, error: message };
  }
}

export async function deleteDraftOperation(
  id: string,
): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };
  try {
    const lineId = id.trim();
    if (!lineId) return { ok: false, error: "id is required" };
    const db = getDb();
    const [deleted] = await db
      .delete(item_operations_draft)
      .where(eq(item_operations_draft.id, lineId))
      .returning({
        id: item_operations_draft.id,
        itemSku: item_operations_draft.item_sku,
      });
    if (!deleted) return { ok: false, error: "Operation not found" };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: deleted.itemSku,
      action: "factory_bom_draft_op_delete",
    });
    revalidateFactory();
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown operation delete failure";
    return { ok: false, error: message };
  }
}

async function collectDraftParents(rootSku: string): Promise<string[]> {
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({ child: product_bom_draft.child_sku, type: sku_mappings.item_type })
      .from(product_bom_draft)
      .leftJoin(sku_mappings, eq(product_bom_draft.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom_draft.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

export async function approveDraftRecipe(
  rootSku: string,
  options?: {
    includePackagingBom?: boolean;
    applyEstimatedWeight?: boolean;
  },
): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  const db = getDb();
  const parents = await collectDraftParents(sku);
  const lines = await db
    .select()
    .from(product_bom_draft)
    .where(inArray(product_bom_draft.parent_sku, parents));

  if (lines.length === 0) {
    return { ok: false, error: "No draft recipe lines to approve" };
  }

  const [estimate] = await db
    .select()
    .from(recipe_estimates_draft)
    .where(eq(recipe_estimates_draft.root_sku, sku))
    .limit(1);

  const includePackaging =
    options?.includePackagingBom === true ||
    estimate?.overrides?.includePackagingBom === true;
  const applyWeight =
    options?.applyEstimatedWeight === true ||
    estimate?.overrides?.applyEstimatedWeight === true;

  const now = new Date();
  for (const line of lines) {
    const { managerNote, cutList } = splitBomNotes(line.notes);
    const notesText = managerNote || null;

    await db
      .insert(product_bom)
      .values({
        parent_sku: line.parent_sku,
        child_sku: line.child_sku,
        quantity: line.quantity,
        scrap_factor: line.scrap_factor,
        unit_of_measure: line.unit_of_measure,
        notes: notesText,
        cut_list: cutList as typeof product_bom.$inferInsert.cut_list,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          scrap_factor: sql`excluded.scrap_factor`,
          unit_of_measure: sql`excluded.unit_of_measure`,
          notes: sql`excluded.notes`,
          cut_list: sql`excluded.cut_list`,
          updated_at: sql`now()`,
        },
      });
  }

  const ops = await db
    .select()
    .from(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parents));
  for (const op of ops) {
    const [exists] = await db
      .select({ id: item_operations.id })
      .from(item_operations)
      .where(
        and(
          eq(item_operations.item_sku, op.item_sku),
          eq(item_operations.work_center, op.work_center),
          eq(item_operations.sequence, op.sequence),
        ),
      )
      .limit(1);
    if (exists) continue;
    await db.insert(item_operations).values({
      item_sku: op.item_sku,
      work_center: op.work_center,
      sequence: op.sequence,
      setup_time_mins: op.setup_time_mins,
      run_time_mins: op.run_time_mins,
      updated_at: now,
    });
  }

  if (applyWeight && estimate) {
    const weight =
      estimate.overrides?.weightLbs ??
      (estimate.est_weight_lbs != null ? Number(estimate.est_weight_lbs) : null);
    if (weight != null && Number.isFinite(weight)) {
      await db
        .update(finished_goods_catalog)
        .set({
          weight: String(Math.round(weight * 10) / 10),
          updated_at: now,
        })
        .where(eq(finished_goods_catalog.global_sku, sku));
    }
  }

  if (includePackaging && estimate?.packaging_bom) {
    const pack = estimate.packaging_bom as {
      lines?: Array<{ sku: string; qty: number; uom: string }>;
    };
    const stem = sku.replace(/^FIN-/, "");
    const packSku = `SA-${stem}-PACK`;
    const [hub] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, packSku))
      .limit(1);
    if (!hub) {
      await db.insert(sku_mappings).values({
        global_sku: packSku,
        category: "Packaging",
        item_type: "sub_assembly",
        original_name: `Packaging kit for ${sku}`,
        source_file: "secondary_extraction_pack",
        is_active: true,
        uom_consume: "ea",
        uom_purchase: "ea",
      });
    }
    await db
      .insert(product_bom)
      .values({
        parent_sku: sku,
        child_sku: packSku,
        quantity: "1.0000",
        scrap_factor: "1.0000",
        unit_of_measure: "ea",
        notes: "Packaging SA from secondary extraction (Approve flag)",
        cut_list: [],
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          notes: sql`excluded.notes`,
          updated_at: sql`now()`,
        },
      });

    for (const line of pack.lines ?? []) {
      const child = line.sku.trim().toUpperCase();
      if (!child) continue;
      const [childHub] = await db
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, child))
        .limit(1);
      if (!childHub) continue;
      await db
        .insert(product_bom)
        .values({
          parent_sku: packSku,
          child_sku: child,
          quantity: Number(line.qty).toFixed(4),
          scrap_factor: "1.0000",
          unit_of_measure: line.uom || "ea",
          notes: "Packaging estimate line",
          cut_list: [],
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: [product_bom.parent_sku, product_bom.child_sku],
          set: {
            quantity: sql`excluded.quantity`,
            unit_of_measure: sql`excluded.unit_of_measure`,
            updated_at: sql`now()`,
          },
        });
    }
  }

  await db
    .update(product_bom_draft)
    .set({
      status: "factory_approved",
      reviewed_by: session.email,
      reviewed_at: now,
      updated_at: now,
    })
    .where(inArray(product_bom_draft.parent_sku, parents));

  await db
    .update(item_operations_draft)
    .set({
      status: "factory_approved",
      reviewed_by: session.email,
      reviewed_at: now,
      updated_at: now,
    })
    .where(inArray(item_operations_draft.item_sku, parents));

  if (estimate) {
    await db
      .update(recipe_estimates_draft)
      .set({
        status: "factory_approved",
        reviewed_by: session.email,
        reviewed_at: now,
        updated_at: now,
      })
      .where(eq(recipe_estimates_draft.root_sku, sku));
  }

  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: "factory_bom_approve",
    newValue: `${lines.length} lines copied to live product_bom${
      includePackaging ? " + packaging" : ""
    }`,
  });
  revalidateFactory();
  return { ok: true };
}

/**
 * Catalog recipe fan-out (POST /recipes), not sales-order MTO.
 * No-ops mutations unless ORDER_PIPELINE_MODE=live or KATANA_E2E_MIRROR=true.
 * Unchanged by secondary extraction unless packaging was copied into live BOM on Approve.
 */
export async function publishApprovedRecipeToKatana(
  rootSku: string,
): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  const result = await syncBOMToKatana(sku);
  if (!result.ok) return { ok: false, error: result.error };

  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: "factory_bom_katana_recipes",
    newValue: result.message ?? "Katana recipe sync",
  });
  revalidateFactory();
  return { ok: true };
}

export async function getRecipeEstimate(
  rootSku: string,
): Promise<RecipeEstimateRow | null> {
  const sku = rootSku.trim().toUpperCase();
  if (!sku) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(recipe_estimates_draft)
    .where(eq(recipe_estimates_draft.root_sku, sku))
    .limit(1);
  if (!row) return null;
  return {
    rootSku: row.root_sku,
    estWeightLbs: row.est_weight_lbs,
    weightBreakdown:
      row.weight_breakdown && typeof row.weight_breakdown === "object"
        ? (row.weight_breakdown as Record<string, number>)
        : {},
    estDimWeightLbs: row.est_dim_weight_lbs,
    cartonLwhIn: row.carton_lwh_in,
    packagingBom: row.packaging_bom,
    estLaborMinutes: row.est_labor_minutes,
    laborBreakdown:
      row.labor_breakdown && typeof row.labor_breakdown === "object"
        ? (row.labor_breakdown as Record<string, unknown>)
        : {},
    estPackagingCost: row.est_packaging_cost,
    overrides: (row.overrides ?? {}) as RecipeEstimateOverrides,
    status: row.status,
    source: row.source,
    calcVersion: row.calc_version,
    inputsHash: row.inputs_hash,
  };
}

export async function recalculateEstimatesAction(
  rootSku: string,
  options?: { forceOps?: boolean },
): Promise<
  | { ok: true; estimate: RecipeEstimateRow }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  try {
    await runSecondaryExtract(sku, { forceOps: options?.forceOps });
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: sku,
      action: "factory_bom_recalculate_estimates",
    });
    revalidateFactory();
    const estimate = await getRecipeEstimate(sku);
    if (!estimate) {
      return { ok: false, error: "Estimate row missing after recalculate" };
    }
    return { ok: true, estimate };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Estimate recalculation failed";
    return { ok: false, error: message };
  }
}

export async function updateEstimateOverridesAction(
  rootSku: string,
  patch: RecipeEstimateOverrides,
): Promise<
  | { ok: true; estimate: RecipeEstimateRow }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  try {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(recipe_estimates_draft)
      .where(eq(recipe_estimates_draft.root_sku, sku))
      .limit(1);
    if (!existing) {
      return {
        ok: false,
        error: "No estimate yet — recalculate from geometry first",
      };
    }

    const overrides: RecipeEstimateOverrides = {
      ...(existing.overrides ?? {}),
      ...patch,
    };

    await db
      .update(recipe_estimates_draft)
      .set({
        overrides,
        status: "edited",
        source: "manager",
        updated_at: new Date(),
      })
      .where(eq(recipe_estimates_draft.root_sku, sku));

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: sku,
      action: "factory_bom_estimate_override",
      newValue: JSON.stringify(patch),
    });
    revalidateFactory();
    const estimate = await getRecipeEstimate(sku);
    if (!estimate) return { ok: false, error: "Estimate missing after update" };
    return { ok: true, estimate };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Override update failed";
    return { ok: false, error: message };
  }
}

export type CadUploadRow = {
  id: string;
  globalSku: string;
  status: CadUploadStatus;
  originalFilename: string;
  ext: string;
  errorMessage: string | null;
  thumbnailUrl: string | null;
  uploadedBy: string | null;
  updatedAt: string;
};

export async function getLatestCadUpload(
  rootSku: string,
): Promise<CadUploadRow | null> {
  const sku = rootSku.trim().toUpperCase();
  if (!sku) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(cad_uploads)
    .where(eq(cad_uploads.global_sku, sku))
    .orderBy(desc(cad_uploads.created_at))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    globalSku: row.global_sku,
    status: row.status,
    originalFilename: row.original_filename,
    ext: row.ext,
    errorMessage: row.error_message,
    thumbnailUrl: row.thumbnail_url,
    uploadedBy: row.uploaded_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function requestCadUpload(input: {
  globalSku: string;
  filename: string;
  byteSize: number;
  contentType?: string;
  sha256?: string;
  forceRename?: boolean;
  replaceImage?: boolean;
}): Promise<
  | {
      ok: true;
      uploadId: string;
      path: string;
      token: string;
      signedUrl: string;
      targetFilename: string;
    }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = input.globalSku.trim().toUpperCase();
  const filename = input.filename.trim();
  if (!sku) return { ok: false, error: "SKU is required" };
  if (!filename) return { ok: false, error: "filename is required" };
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "byteSize must be positive" };
  }
  if (input.byteSize > CAD_MAX_BYTES) {
    return {
      ok: false,
      error: `File exceeds ${CAD_MAX_BYTES / (1024 * 1024)} MiB v1 limit`,
    };
  }

  const extRaw = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (extRaw !== "dae" && extRaw !== "skp") {
    return {
      ok: false,
      error: "Only .dae (geometry) or .skp (thumbnail) CAD files are accepted",
    };
  }

  const stem = filename
    .replace(/\.[^.]+$/, "")
    .trim()
    .toUpperCase();
  if (stem !== sku && !input.forceRename) {
    return {
      ok: false,
      error: `Filename stem "${stem}" must match selected SKU ${sku} (or confirm force rename)`,
    };
  }

  try {
    const db = getDb();
    const [hub] = await db
      .select({ item_type: sku_mappings.item_type })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);
    if (!hub) return { ok: false, error: `SKU not found: ${sku}` };
    if (hub.item_type !== "finished_good") {
      return { ok: false, error: "CAD upload targets finished_good SKUs only" };
    }

    const signed = await createCadSignedUpload({ globalSku: sku, ext: extRaw });
    const [row] = await db
      .insert(cad_uploads)
      .values({
        global_sku: sku,
        storage_path: signed.path,
        original_filename: filename,
        content_type: input.contentType ?? null,
        byte_size: Math.trunc(input.byteSize),
        sha256: input.sha256 ?? null,
        ext: extRaw,
        status: "uploaded",
        force_rename: Boolean(input.forceRename),
        replace_image: Boolean(input.replaceImage),
        uploaded_by: session.email,
      })
      .returning();

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: sku,
      action: "factory_bom_cad_upload_request",
      newValue: signed.path,
    });

    return {
      ok: true,
      uploadId: row.id,
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
      targetFilename: `${sku}.${extRaw}`,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "CAD upload request failed";
    return { ok: false, error: message };
  }
}

export async function confirmCadUpload(
  uploadId: string,
): Promise<BomMutationResult & { status?: CadUploadStatus }> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const id = uploadId.trim();
  if (!id) return { ok: false, error: "uploadId is required" };

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(cad_uploads)
      .where(eq(cad_uploads.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "Upload not found" };

    const eventId = `cad-uploaded-${row.id}`;
    await db
      .update(cad_uploads)
      .set({
        status: "queued",
        inngest_event_id: eventId,
        updated_at: new Date(),
      })
      .where(eq(cad_uploads.id, row.id));

    const payload = {
      uploadId: row.id,
      globalSku: row.global_sku,
      storagePath: row.storage_path,
      ext: (row.ext === "skp" ? "skp" : "dae") as "dae" | "skp",
      sha256: row.sha256 ?? undefined,
      operatorEmail: session.email,
      replaceImage: row.replace_image,
    };

    let queuedRemote = false;
    const forceInline = process.env.CAD_UPLOAD_INLINE === "true";
    const hasInngestKey = Boolean(process.env.INNGEST_EVENT_KEY?.trim());

    if (hasInngestKey && !forceInline) {
      try {
        await inngest.send({
          name: CAD_UPLOADED_EVENT,
          data: payload,
          id: eventId,
        });
        queuedRemote = true;
      } catch {
        queuedRemote = false;
      }
    }

    // Missing Inngest keys / force-inline: process in-request so Factory BOM stays usable.
    if (!queuedRemote) {
      const result = await processCadUploadJob(payload);
      revalidateFactory();
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, status: "draft_ready" };
    }

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.global_sku,
      action: "factory_bom_cad_upload_queued",
      newValue: eventId,
    });
    revalidateFactory();
    return { ok: true, status: "queued" };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "CAD confirm failed";
    return { ok: false, error: message };
  }
}

export async function uploadCadStillImage(input: {
  globalSku: string;
  base64: string;
  contentType: string;
  replaceImage?: boolean;
}): Promise<BomMutationResult & { imageUrl?: string }> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = input.globalSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };
  if (!input.base64?.trim()) return { ok: false, error: "image is required" };

  const mime = input.contentType.trim().toLowerCase();
  if (!mime.startsWith("image/")) {
    return { ok: false, error: "contentType must be image/*" };
  }
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : "jpg";

  try {
    const db = getDb();
    const [fg] = await db
      .select({ image: finished_goods_catalog.image_url })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, sku))
      .limit(1);
    if (fg?.image?.trim() && !input.replaceImage) {
      return {
        ok: false,
        error: "Catalog already has an image — check Replace image to overwrite",
      };
    }

    const buffer = Buffer.from(input.base64, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      return { ok: false, error: "Image exceeds 5 MiB" };
    }
    const imageUrl = await uploadProductImage({
      globalSku: sku,
      buffer,
      contentType: mime,
      ext,
    });
    await db
      .update(finished_goods_catalog)
      .set({
        image_url: imageUrl,
        updated_at: new Date(),
        updated_by: session.email,
      })
      .where(eq(finished_goods_catalog.global_sku, sku));

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: sku,
      action: "factory_bom_cad_still_upload",
      newValue: imageUrl,
    });
    revalidateFactory();
    return { ok: true, imageUrl };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Still image upload failed";
    return { ok: false, error: message };
  }
}

export { searchBomMaterials };
