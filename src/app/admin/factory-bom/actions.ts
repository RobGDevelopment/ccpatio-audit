"use server";

import { mintCustomJob } from "@/server/factory-bom/mint-custom-job";
import { promoteToCatalog } from "@/server/factory-bom/promote-to-catalog";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  listFactoryProducts as loadFactoryProducts,
  type FactoryProductRow as FactoryProductListRow,
} from "@/server/factory-bom/list-factory-products";
import { revalidatePath } from "next/cache";
import {
  searchBomMaterials,
  type BomComponentCandidate,
  type BomMutationResult,
  type BomTreeNode,
} from "@/app/admin/dictionary/actions";
import { CAD_UPLOADED_EVENT } from "@/lib/cad-upload";
import { processCadUploadJob } from "@/lib/cad-upload/process-job";
import {
  getStandardTrack,
  isKatanaResource,
  normalizeKatanaResource,
  type StandardTrackId,
} from "@/lib/factory-routing/resources";
import { getPimSession, logPimAudit } from "@/lib/pim-audit";
import { order_intake } from "@/server/db/schema";
import { matchFactoryOrderLine } from "@/server/factory-bom/match-factory-order-line";
import { subAssemblySku } from "@/lib/heuristic-bom";
import { syncBOMToKatana } from "@/lib/katana";
import { getCatalogPublishMode, canMutateKatanaCatalog } from "@/server/pipeline/catalog-mode";
import { upsertChannelSync } from "@/server/mdm/channel-sync";
import { runSecondaryExtract } from "@/lib/secondary-extraction";
import {
  coerceCutListColumn,
  formatKatanaIngredientNote,
  resolveDraftCutsAndNote,
  type CutLine,
} from "@/lib/sketchup-cutlist";
import { inngest } from "@/inngest/client";
import {
  CAD_MAX_BYTES,
  createCadSignedUpload,
  uploadProductImage, getSupabaseAdmin, PRODUCT_DOCUMENTS_BUCKET,
} from "@/lib/supabase-storage";
import { getDb } from "@/server/db/client";
import {
  cad_uploads,
  finished_goods_catalog,
  item_operations,
  item_operations_draft,
  product_bom, product_assets, factory_release_gate,
  product_bom_draft,
  recipe_estimates_draft,
  sku_mappings,
  channel_sync,
  type CadUploadStatus,
  type ItemType,
  type RecipeReviewStatus,
} from "@/server/db/schema";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import { loadAirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import { renderShopDrawingPdf } from "@/server/factory-bom/shop-drawing";
import { computeDossierHash } from "@/server/factory-bom/dossier-hash";
import { buildStorageKey, sha256Hex } from "@/server/pim/asset-vault";
import { type AirlockDossier } from "@/server/factory-bom/airlock.schema";
import { resetReleaseGate } from "@/server/factory-bom/release-gate";

export type { BomComponentCandidate, BomTreeNode };

export type FactoryProductRow = FactoryProductListRow;

export async function listFactoryProducts(): Promise<FactoryProductRow[]> {
  return loadFactoryProducts();
}

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
  /** Manager note only (never JSON trailer). */
  notes: string | null;
  /** Structured cut cards; empty when none. */
  cutList: CutLine[];
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
    revalidatePath("/embed/factory-bom");
    revalidatePath("/admin/dictionary");
  } catch {
    // vitest / scripts
  }
}

async function invalidateGateForDraftSku(sku: string) {
  const db = getDb();
  const queue = [sku];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const [mapping] = await db
      .select({ item_type: sku_mappings.item_type })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, current))
      .limit(1);
    if (mapping?.item_type === "finished_good") {
      await resetReleaseGate(current);
    } else if (mapping?.item_type === "sub_assembly") {
      const parents = await db
        .selectDistinct({ parent_sku: product_bom_draft.parent_sku })
        .from(product_bom_draft)
        .where(eq(product_bom_draft.child_sku, current));
      queue.push(...parents.map((p) => p.parent_sku));
    }
  }
}

function parseQuantity(raw: string): string | null {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(4);
}

/** Setup/run minutes — zero allowed (QC often has 0 setup). */
function parseTimeMins(raw: string): string | null {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(4);
}

async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await getPimSession();
  if (!session) return { error: "Sign in required" };
  return { email: session.email };
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

  return rows.map((row) => {
    const resolved = resolveDraftCutsAndNote({
      notes: row.line.notes,
      cutList: row.line.cut_list,
    });
    return {
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
      notes: resolved.managerNote || null,
      cutList: resolved.cutList,
    };
  });
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
  cutList?: CutLine[] | null;
}): Promise<BomMutationResult> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  try {
    const parentSku = data.parentSku.trim().toUpperCase();
    const childSku = data.childSku.trim().toUpperCase();
    const quantity = parseQuantity(data.quantity);
    const scrapFactor = parseQuantity(data.scrapFactor ?? "1") ?? "1.0000";
    const unitOfMeasure = data.unitOfMeasure.trim().toLowerCase();
    // Manager note only — strip any accidental trailer a client might send.
    const notes =
      data.notes === undefined
        ? undefined
        : data.notes === null
          ? null
          : resolveDraftCutsAndNote({ notes: data.notes }).managerNote || null;
    const cutList =
      data.cutList === undefined
        ? undefined
        : coerceCutListColumn(data.cutList ?? []);

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
          ...(cutList !== undefined ? { cut_list: cutList } : {}),
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
        cut_list: cutList ?? [],
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
    await invalidateGateForDraftSku(parentSku);
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
  await invalidateGateForDraftSku(deleted.parent);
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
    const workCenter = normalizeKatanaResource(data.workCenter.trim());
    const sequence = Number(data.sequence);
    const setup = data.setupTimeMins?.trim()
      ? parseTimeMins(data.setupTimeMins)
      : null;
    const run = data.runTimeMins?.trim()
      ? parseTimeMins(data.runTimeMins)
      : null;

    if (!itemSku) return { ok: false, error: "item_sku is required" };
    if (!workCenter) return { ok: false, error: "work_center is required" };
    if (!Number.isFinite(sequence) || sequence < 0) {
      return { ok: false, error: "sequence must be a non-negative integer" };
    }
    if (data.setupTimeMins?.trim() && setup === null) {
      return { ok: false, error: "setup_time_mins must be a non-negative number" };
    }
    if (data.runTimeMins?.trim() && run === null) {
      return { ok: false, error: "run_time_mins must be a non-negative number" };
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
      await invalidateGateForDraftSku(itemSku);
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
    await invalidateGateForDraftSku(itemSku);
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
    await invalidateGateForDraftSku(deleted.itemSku);
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

export type ApplyStandardTrackInput = {
  itemSku: string;
  trackId: StandardTrackId;
  mode?: "fill_gaps" | "replace";
};

export async function applyStandardTrack(
  data: ApplyStandardTrackInput,
): Promise<
  | { ok: true; inserted: number; skipped: number; removed: number }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  try {
    const itemSku = data.itemSku.trim().toUpperCase();
    const mode = data.mode ?? "fill_gaps";
    const track = getStandardTrack(data.trackId);
    if (!itemSku) return { ok: false, error: "item_sku is required" };
    if (!track?.length) {
      return { ok: false, error: `Unknown track: ${data.trackId}` };
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
    let removed = 0;
    if (mode === "replace") {
      const deleted = await db
        .delete(item_operations_draft)
        .where(eq(item_operations_draft.item_sku, itemSku))
        .returning({ id: item_operations_draft.id });
      removed = deleted.length;
    }

    const existing = await db
      .select({
        workCenter: item_operations_draft.work_center,
        sequence: item_operations_draft.sequence,
      })
      .from(item_operations_draft)
      .where(eq(item_operations_draft.item_sku, itemSku));

    const existingKeys = new Set(
      existing.map((row) => `${row.workCenter}::${row.sequence}`),
    );

    let inserted = 0;
    let skipped = 0;
    for (const step of track) {
      if (!isKatanaResource(step.resource)) {
        return {
          ok: false,
          error: `Track step uses unknown Resource: ${step.resource}`,
        };
      }
      const key = `${step.resource}::${step.sequence}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      await db.insert(item_operations_draft).values({
        item_sku: itemSku,
        work_center: step.resource,
        sequence: step.sequence,
        setup_time_mins:
          step.setupTimeMins > 0 ? step.setupTimeMins.toFixed(4) : "0.0000",
        run_time_mins: step.runTimeMins.toFixed(4),
        status: "edited",
        source: "manager",
        notes: step.floorLabel,
        updated_at: now,
      });
      existingKeys.add(key);
      inserted += 1;
    }

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: itemSku,
      action: "factory_bom_apply_standard_track",
      field: data.trackId,
      newValue: `${mode}:${inserted}`,
    });
    await invalidateGateForDraftSku(itemSku);
    revalidateFactory();
    return { ok: true, inserted, skipped, removed };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown standard track apply failure";
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
): Promise<BomMutationResult & { blockingCodes?: string[]; dryRun?: boolean }> {
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

  const ops = await db
    .select()
    .from(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parents));

  const allSkus = new Set<string>();
  for (const p of parents) allSkus.add(p);
  for (const l of lines) allSkus.add(l.child_sku);
  
  const skuMap = new Map<string, any>();
  if (allSkus.size > 0) {
     const mapped = await db.select({
       sku: sku_mappings.global_sku,
       itemType: sku_mappings.item_type,
       originalName: sku_mappings.original_name,
       katanaVariantId: sku_mappings.katana_variant_id,
       category: sku_mappings.category,
     }).from(sku_mappings).where(inArray(sku_mappings.global_sku, Array.from(allSkus)));
     for (const m of mapped) skuMap.set(m.sku, m);
  }
  
  const rootMeta = skuMap.get(sku);
  if (!rootMeta) return { ok: false, error: "Root SKU metadata not found" };

  const [latestCad] = await db
    .select()
    .from(cad_uploads)
    .where(eq(cad_uploads.global_sku, sku))
    .orderBy(desc(cad_uploads.created_at))
    .limit(1);

  let cadNode = null;
  if (latestCad && (latestCad.ext === "dae" || latestCad.ext === "glb")) {
    const snap = latestCad.geometry_snapshot as any;
    cadNode = {
      uploadId: latestCad.id,
      ext: latestCad.ext as "dae" | "glb",
      status: (latestCad.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
      sha256: latestCad.sha256 || "",
      hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
    };
  }

  const checklist = {
    identityConfirmed: true as const,
    cutListConfirmed: true as const,
    operationsConfirmed: true as const,
    quarantineConfirmed: true as const,
  };

  const nodes = parents.map(parentSku => {
    const pMeta = skuMap.get(parentSku);
    const parentLines = lines.filter(l => l.parent_sku === parentSku).map(l => {
       const cMeta = skuMap.get(l.child_sku);
       const isMetal = Boolean(
         cMeta?.category?.match(/metal|aluminum|tube|flat bar/i) ||
         (Array.isArray(l.cut_list) && l.cut_list.length > 0 && (l.cut_list[0] as any).profile !== "UNKNOWN") ||
         ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") && Array.isArray(l.cut_list) && l.cut_list.length > 0)
       );
       
       return {
         parentSku: l.parent_sku,
         childSku: l.child_sku,
         itemType: cMeta?.itemType as any,
         quantity: Number(l.quantity),
         scrapFactor: Number(l.scrap_factor),
         unitOfMeasure: l.unit_of_measure as any,
         status: l.status,
         source: l.source,
         notes: l.notes,
         cutList: (Array.isArray(l.cut_list) ? (l.cut_list as any).map((c: any) => ({

           role: c.role || "",
           profile: c.profile || "UNKNOWN",
           lengthIn: Number(c.lengthIn) || 0,
           endA: c.endA,
           endB: c.endB,
           qtyEa: c.qtyEa,
           lengthConvention: c.lengthConvention,
           sourceName: c.sourceName || "",
           confidence: c.confidence,
           drawingPartNumber: c.drawingPartNumber
         })) : []) as any,
         isMetal
       };
    });
    const parentOps = ops.filter(o => o.item_sku === parentSku).map(o => ({
       itemSku: o.item_sku,
       workCenter: o.work_center,
       sequence: o.sequence,
       setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
       runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
    }));
    return {
      sku: parentSku,
      itemType: pMeta?.itemType as any,
      lines: parentLines,
      operations: parentOps,
    };
  });

  const dossier: AirlockDossier = {
    rootSku: sku,
    identity: {
      itemType: rootMeta.itemType as any,
      originalName: rootMeta.originalName || "",
      katanaVariantId: rootMeta.katanaVariantId,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist,
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "Validation failed: " + blockingCodes.join(", "), blockingCodes };
  }

  const now = new Date();
  for (const line of lines) {
    const { managerNote, cutList } = resolveDraftCutsAndNote({
      notes: line.notes,
      cutList: line.cut_list,
    });
    // Tablet-ready: manager text, else formatKatanaIngredientNote from structure.
    const notesText =
      managerNote.trim() ||
      (cutList.length > 0 ? formatKatanaIngredientNote(cutList) : null) ||
      null;

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
  for (const op of ops) {
    await db
      .insert(item_operations)
      .values({
        item_sku: op.item_sku,
        work_center: op.work_center,
        sequence: op.sequence,
        setup_time_mins: op.setup_time_mins,
        run_time_mins: op.run_time_mins,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          item_operations.item_sku,
          item_operations.work_center,
          item_operations.sequence,
        ],
        set: {
          setup_time_mins: sql`excluded.setup_time_mins`,
          run_time_mins: sql`excluded.run_time_mins`,
          updated_at: sql`now()`,
        },
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
    const packSku = subAssemblySku(sku, "PACK");
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
 * Mutations gated by CATALOG_PUBLISH_MODE (or KATANA_E2E_MIRROR / legacy ORDER_PIPELINE_MODE=live).
 * Writes channel_sync so Factory Publish shares the MDM spoke ledger.
 */
export async function publishApprovedRecipeToKatana(
  rootSku: string,
): Promise<
  BomMutationResult & {
    blockingCodes?: string[];
    dryRun?: boolean;
    dossierHash?: string;
    message?: string;
    idempotent?: boolean;
  }
> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  const snapshot = await loadAirlockSnapshot(sku);
  const db = getDb();
  const allSkus = new Set<string>();
  allSkus.add(sku);
  snapshot.lines.forEach(l => {
    allSkus.add(l.parent_sku);
    allSkus.add(l.child_sku);
  });

  const skuMap = new Map<string, any>();
  if (allSkus.size > 0) {
     const mapped = await db.select({
       sku: sku_mappings.global_sku,
       itemType: sku_mappings.item_type,
       originalName: sku_mappings.original_name,
       katanaVariantId: sku_mappings.katana_variant_id,
       category: sku_mappings.category,
     }).from(sku_mappings).where(inArray(sku_mappings.global_sku, Array.from(allSkus)));
     for (const m of mapped) skuMap.set(m.sku, m);
  }

  const rootMeta = skuMap.get(sku);
  if (!rootMeta) return { ok: false, error: "Root meta not found" };

  let cadNode = null;
  if (snapshot.cadUpload && (snapshot.cadUpload.ext === "dae" || snapshot.cadUpload.ext === "glb")) {
    const snap = snapshot.cadUpload.geometry_snapshot as any;
    cadNode = {
      uploadId: snapshot.cadUpload.id,
      ext: snapshot.cadUpload.ext as "dae" | "glb",
      status: (snapshot.cadUpload.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
      sha256: snapshot.cadUpload.sha256 || "",
      hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
    };
  }

  const parents = Array.from(allSkus).filter(s => 
    s === sku || snapshot.lines.some(l => l.parent_sku === s)
  );

  const nodes = parents.map(parentSku => {
    const pMeta = skuMap.get(parentSku);
    const parentLines = snapshot.lines.filter(l => l.parent_sku === parentSku).map(l => {
       const cMeta = skuMap.get(l.child_sku);
       const cat = cMeta?.category || "";
       const isMetal = Boolean(
         cat.match(/metal|aluminum|tube|flat bar/i) ||
         (Array.isArray(l.cut_list) && l.cut_list.length > 0 && (l.cut_list[0] as any).profile !== "UNKNOWN") ||
         ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") && Array.isArray(l.cut_list) && l.cut_list.length > 0)
       );
       return {
         parentSku: l.parent_sku,
         childSku: l.child_sku,
         itemType: (cMeta as any)?.itemType || "raw_material",
         quantity: Number(l.quantity),
         scrapFactor: Number(l.scrap_factor),
         unitOfMeasure: l.unit_of_measure as any,
         status: l.status as any,
         source: l.source,
         notes: l.notes,
         cutList: (Array.isArray(l.cut_list) ? (l.cut_list as any).map((c: any) => c) : []) as any,
         isMetal
       };
    });
    const parentOps = snapshot.operations.filter(o => o.item_sku === parentSku).map(o => ({
       itemSku: o.item_sku,
       workCenter: o.work_center,
       sequence: o.sequence,
       setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
       runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
    }));
    return {
      sku: parentSku,
      itemType: (pMeta as any)?.itemType || "sub_assembly",
      lines: parentLines,
      operations: parentOps,
    };
  });

  const dossier: AirlockDossier = {
    rootSku: sku,
    identity: {
      itemType: rootMeta.itemType || "finished_good",
      originalName: rootMeta.originalName || "",
      katanaVariantId: rootMeta.katanaVariantId || null,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist: {
      identityConfirmed: true as true,
      cutListConfirmed: true as true,
      operationsConfirmed: true as true,
      quarantineConfirmed: true as true,
    },
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "Airlock validation failed", blockingCodes };
  }

  const allCuts = dossier.nodes.flatMap(n => n.lines.flatMap(l => l.cutList));
  const pdfBytes = renderShopDrawingPdf({
    rootSku: sku,
    originalName: dossier.identity.originalName,
    cadExt: cadNode?.ext || "glb",
    cadSha256: cadNode?.sha256 || "",
    cutList: allCuts as any,
    geometrySnapshot: (snapshot.cadUpload?.geometry_snapshot as any) || { components: [] }
  });

  const shopDrawingSha256 = sha256Hex(pdfBytes);
  const [currentDrawing] = await db
    .select()
    .from(product_assets)
    .where(
      and(
        eq(product_assets.global_sku, sku),
        eq(product_assets.kind, "shop_drawing"),
        eq(product_assets.is_current, true),
      ),
    )
    .limit(1);

  let storagePath = currentDrawing?.storage_path ?? "";
  if (!(currentDrawing?.sha256 === shopDrawingSha256 && storagePath)) {
    const revision = (currentDrawing?.revision ?? 0) + 1;
    storagePath = buildStorageKey(sku, "shop_drawing", revision, "pdf");
    const { error: uploadErr } = await getSupabaseAdmin()
      .storage.from(PRODUCT_DOCUMENTS_BUCKET)
      .upload(storagePath, pdfBytes, { contentType: "application/pdf" });
    if (uploadErr) {
      return { ok: false, error: "SHOP_DRAWING_REQUIRED", blockingCodes: ["SHOP_DRAWING_REQUIRED"] };
    }
    await db.transaction(async (tx) => {
      if (currentDrawing) {
        await tx
          .update(product_assets)
          .set({ is_current: false, superseded_at: new Date(), updated_at: new Date() })
          .where(eq(product_assets.id, currentDrawing.id));
      }
      await tx.insert(product_assets).values({
        global_sku: sku,
        kind: "shop_drawing",
        revision,
        storage_path: storagePath,
        original_filename: `shop_drawing_${sku}.pdf`,
        content_type: "application/pdf",
        byte_size: pdfBytes.length,
        sha256: shopDrawingSha256,
        is_current: true,
      });
    });
  }

  const [firstLine] = snapshot.lines
    .filter((line) => line.parent_sku === sku)
    .slice()
    .sort((a, b) => a.child_sku.localeCompare(b.child_sku));
  if (firstLine) {
    const shopSuffix = `Shop:${storagePath}`;
    const baseNote = (firstLine.notes || "").trim();
    const newNote = baseNote.endsWith(shopSuffix)
      ? baseNote
      : baseNote
        ? `${baseNote} | ${shopSuffix}`
        : shopSuffix;
    if (newNote.length > 255) {
      return { ok: false, error: "SHOP_NOTE", blockingCodes: ["SHOP_NOTE"] };
    }
    await db.update(product_bom_draft)
      .set({ notes: newNote })
      .where(eq(product_bom_draft.id, firstLine.id));

    const rootNode = dossier.nodes.find(n => n.sku === sku);
    if (rootNode) {
      const rootDossierLine = rootNode.lines.find(l => l.childSku === firstLine.child_sku);
      if (rootDossierLine) rootDossierLine.notes = newNote;
    }
  }

  const dossierHash = computeDossierHash(dossier, shopDrawingSha256);
  if (snapshot.releaseGate?.dossier_hash && snapshot.releaseGate.dossier_hash !== dossierHash) {
    await resetReleaseGate(sku, ["CHECKLIST"]);
    return { ok: false, error: "CHECKLIST", blockingCodes: ["CHECKLIST"] };
  }
  
  const approveRes = await approveDraftRecipe(sku);
  if (!approveRes.ok) return approveRes;
  
  await db.update(factory_release_gate)
    .set({ dossier_hash: dossierHash })
    .where(eq(factory_release_gate.root_sku, sku));

  if (!dossier.identity.katanaVariantId) {
    return { ok: false, error: "KATANA_VARIANT_UNRESOLVED", blockingCodes: ["KATANA_VARIANT_UNRESOLVED"] };
  }
  for (const node of dossier.nodes) {
    for (const line of node.lines) {
      const childMeta = skuMap.get(line.childSku);
      if (!childMeta?.katanaVariantId) {
         return { ok: false, error: `KATANA_VARIANT_UNRESOLVED: ${line.childSku}`, blockingCodes: ["KATANA_VARIANT_UNRESOLVED"] };
      }
    }
  }

  const catalogMode = getCatalogPublishMode();
  const dryRun = !canMutateKatanaCatalog(catalogMode);

  const [existingSync] = await db
    .select()
    .from(channel_sync)
    .where(
      and(
        eq(channel_sync.global_sku, sku),
        eq(channel_sync.channel, "katana")
      )
    )
    .limit(1);

  if (existingSync?.status === "success" && existingSync.payload_hash === dossierHash) {
    return { 
      ok: true, 
      idempotent: true, 
      dossierHash, 
      message: "Idempotent skip: dossier hash unchanged" 
    };
  }

  const result = await syncBOMToKatana(sku, {
    fromAirlock: true,
    idempotencyKey: `factory-bom:${sku}:${dossierHash}`,
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (dryRun || result.dryRun) {
    return {
      ok: true,
      dryRun: true,
      dossierHash,
      message: `${result.message} Nothing was sent to Katana.`,
    };
  }

  await upsertChannelSync({
    globalSku: sku,
    channel: "katana",
    status: result.dryRun ? "pending" : "success",
    externalId: result.productVariantId != null ? String(result.productVariantId) : null,
    lastError: null,
    payloadHash: dossierHash,
  });

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
  const session = await requireSession();
  if ("error" in session) return null;
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
  if (extRaw !== "dae" && extRaw !== "skp" && extRaw !== "glb") {
    return {
      ok: false,
      error: "Only .dae or .glb (geometry) or .skp (thumbnail) CAD files are accepted",
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
      ext: row.ext as "dae" | "skp" | "glb",
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

export async function beginAirlockIntake(input: {
  mode: "custom_build" | "catalog";
  clientSlug?: string;
  itemSlug?: string;
  ghlOpportunityId?: string;
  originalName?: string;
  category?: string;
  collection?: string;
  length?: string;
  depth?: string;
  displayName?: string;
  packetStoragePath?: string;
}) {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized" };

  try {
    if (input.mode === "custom_build") {
      if (!input.clientSlug || !input.itemSlug) {
        return { ok: false, error: "Missing required fields for custom build" };
      }
      const job = await mintCustomJob(
        {
          clientSlug: input.clientSlug,
          itemSlug: input.itemSlug,
          ghlOpportunityId: input.ghlOpportunityId,
          displayName: input.displayName || `${input.clientSlug} ${input.itemSlug}`,
          createdBy: session.email,
          packetStoragePath: input.packetStoragePath,
        },
        { forceRecreate: true }
      );
      return { ok: true, sku: job.globalSku };
    } else {
      if (!input.originalName || !input.category) {
        return { ok: false, error: "Missing required fields for catalog promotion" };
      }
      const res = await promoteToCatalog({
        originalName: input.originalName,
        category: input.category,
        collection: input.collection,
        length: input.length,
        depth: input.depth,
        createdBy: session.email,
      });
      return { ok: true, sku: res.globalSku };
    }
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}

export async function uploadFactoryPacketAction(formData: FormData) {
  const file = formData.get("file") as File | null;
  const opportunityId = formData.get("opportunityId") as string | null;
  if (!file) return { ok: false, error: "No file provided" };
  
  try {
    const text = await file.text();
    const rawLines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const lines = [];
    for (const raw of rawLines) {
      lines.push(await matchFactoryOrderLine(raw));
    }
    
    const packetStoragePath = "s3://ccpatio-packets/" + encodeURIComponent(file.name);
    
    if (opportunityId) {
      const db = getDb();
      await db.update(order_intake).set({
        mapped_lines: lines as any,
      }).where(eq(order_intake.ghl_opportunity_id, opportunityId));
    }
    
    return { ok: true, lines, packetStoragePath };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
