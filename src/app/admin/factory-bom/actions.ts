"use server";

import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  searchBomMaterials,
  type BomComponentCandidate,
  type BomMutationResult,
  type BomTreeNode,
} from "@/app/admin/dictionary/actions";
import { getPimSession, logPimAudit } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  sku_mappings,
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
}): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  try {
    const parentSku = data.parentSku.trim().toUpperCase();
    const childSku = data.childSku.trim().toUpperCase();
    const quantity = parseQuantity(data.quantity);
    const scrapFactor = parseQuantity(data.scrapFactor ?? "1") ?? "1.0000";
    const unitOfMeasure = data.unitOfMeasure.trim().toLowerCase();

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

  const now = new Date();
  for (const line of lines) {
    await db
      .insert(product_bom)
      .values({
        parent_sku: line.parent_sku,
        child_sku: line.child_sku,
        quantity: line.quantity,
        scrap_factor: line.scrap_factor,
        unit_of_measure: line.unit_of_measure,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          scrap_factor: sql`excluded.scrap_factor`,
          unit_of_measure: sql`excluded.unit_of_measure`,
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

  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: "factory_bom_approve",
    newValue: `${lines.length} lines copied to live product_bom`,
  });
  revalidateFactory();
  return { ok: true };
}

export { searchBomMaterials };
