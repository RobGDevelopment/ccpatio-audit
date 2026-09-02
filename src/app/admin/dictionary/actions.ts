"use server";

import { createClient } from "@supabase/supabase-js";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateFinishedGoodSku } from "@/lib/sku-engine";
import {
  buildRawMaterialSkuBase,
  nextAvailableSku,
} from "@/lib/raw-material-sku";
import { isNaToken } from "./pim-catalog-utils";
import {
  skuMappingCreateSchema,
  validateAttributeFieldPatch,
  validateCatalogFieldPatch,
  validateMappingFieldPatch,
  validateRawMaterialCost,
} from "@/server/pim/patch-validation";
import {
  syncBOMToKatana,
  syncFinishedGoodToKatana,
} from "@/lib/katana";
import { getDb } from "@/server/db/client";
import { logPimAudit, resolvePimOperator } from "@/lib/pim-audit";
import {
  finished_goods_catalog,
  item_operations,
  product_bom,
  raw_materials_catalog,
  sku_aliases,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";

const BUCKET = "product-images";

function revalidateDictionary(): void {
  try {
    revalidatePath("/");
    revalidatePath("/admin/dictionary");
    revalidatePath("/admin/audit");
  } catch {
    // Outside Next.js request context (vitest, scripts) — cache bust is best-effort.
  }
}

export type SaveCatalogResult =
  | { ok: true; imageUrl: string | null; newSku: string }
  | { ok: false; error: string; message?: string };

export type BomLine = {
  id: string;
  parentSku: string;
  childSku: string;
  quantity: string;
  scrapFactor: string;
  unitOfMeasure: string;
  childItemType: ItemType | null;
  childName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BomTreeNode = {
  sku: string;
  name: string;
  itemType: ItemType;
  depth: number;
  lineId: string | null;
  quantity: string | null;
  scrapFactor: string | null;
  unitOfMeasure: string | null;
  children: BomTreeNode[];
};

export type UpsertBOMLineInput = {
  id?: string;
  parentSku: string;
  childSku: string;
  quantity: string;
  scrapFactor?: string;
  unitOfMeasure: string;
  /** @deprecated transitional aliases */
  finishedGoodSku?: string;
  componentSku?: string;
};

export type BomMutationResult =
  | { ok: true; line?: BomLine }
  | { ok: false; error: string };

export type ItemOperationRow = {
  id: string;
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins: string | null;
  runTimeMins: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertItemOperationInput = {
  id?: string;
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins?: string;
  runTimeMins?: string;
};

export type BomComponentCandidate = {
  sku: string;
  name: string;
  itemType: ItemType;
  category: string;
  uom: string | null;
};

function mapBomRow(
  row: typeof product_bom.$inferSelect,
  child?: { item_type: ItemType; original_name: string } | null,
): BomLine {
  return {
    id: row.id,
    parentSku: row.parent_sku,
    childSku: row.child_sku,
    quantity: row.quantity,
    scrapFactor: row.scrap_factor ?? "1.0000",
    unitOfMeasure: row.unit_of_measure,
    childItemType: child?.item_type ?? null,
    childName: child?.original_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOperationRow(
  row: typeof item_operations.$inferSelect,
): ItemOperationRow {
  return {
    id: row.id,
    itemSku: row.item_sku,
    workCenter: row.work_center,
    sequence: row.sequence,
    setupTimeMins: row.setup_time_mins,
    runTimeMins: row.run_time_mins,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseQuantity(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "0";
  }
  const normalized = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return "0";
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  return normalized;
}

function parseScrapFactor(raw: string | undefined): string | null {
  if (raw == null || !raw.trim()) {
    return "1.0000";
  }
  const normalized = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return "1.0000";
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return "1.0000";
  }
  return Number(n).toFixed(4);
}

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
]);

const PRODUCIBLE: ItemType[] = ["finished_good", "sub_assembly"];
const CHILD_ALLOWED: ItemType[] = ["raw_material", "sub_assembly"];

async function wouldCreateCycle(
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
      .select({ child: product_bom.child_sku })
      .from(product_bom)
      .where(eq(product_bom.parent_sku, current));
    for (const k of kids) {
      queue.push(k.child);
    }
  }
  return false;
}

export async function getBOMForProduct(sku: string): Promise<BomLine[]> {
  const parentSku = sku.trim();
  if (!parentSku) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      line: product_bom,
      childType: sku_mappings.item_type,
      childName: sku_mappings.original_name,
    })
    .from(product_bom)
    .leftJoin(sku_mappings, eq(product_bom.child_sku, sku_mappings.global_sku))
    .where(eq(product_bom.parent_sku, parentSku))
    .orderBy(asc(product_bom.child_sku));

  return rows.map((r) =>
    mapBomRow(r.line, {
      item_type: r.childType ?? "raw_material",
      original_name: r.childName ?? "",
    }),
  );
}

export async function getBomTree(rootSku: string): Promise<BomTreeNode | null> {
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
      .from(product_bom)
      .where(eq(product_bom.parent_sku, sku))
      .orderBy(asc(product_bom.child_sku));

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

export async function searchBomComponents(
  query: string,
): Promise<BomComponentCandidate[]> {
  const q = query.trim();
  const db = getDb();
  const filters = [
    inArray(sku_mappings.item_type, CHILD_ALLOWED),
    eq(sku_mappings.is_active, true),
  ];
  if (q.length > 0) {
    filters.push(
      or(
        ilike(sku_mappings.global_sku, `%${q}%`),
        ilike(sku_mappings.original_name, `%${q}%`),
        ilike(sku_mappings.category, `%${q}%`),
      )!,
    );
  }

  return db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
      category: sku_mappings.category,
      uom: sku_mappings.uom_consume,
    })
    .from(sku_mappings)
    .where(and(...filters))
    .orderBy(asc(sku_mappings.global_sku))
    .limit(24);
}

export async function upsertBOMLine(
  data: UpsertBOMLineInput,
): Promise<BomMutationResult> {
  try {
    const parentSku = (data.parentSku || data.finishedGoodSku || "")
      .trim()
      .toUpperCase();
    const childSku = (data.childSku || data.componentSku || "")
      .trim()
      .toUpperCase();
    const quantity = parseQuantity(data.quantity);
    const scrapFactor = parseScrapFactor(data.scrapFactor);
    const unitOfMeasure = data.unitOfMeasure.trim().toLowerCase();

    if (!parentSku) {
      return { ok: false, error: "parent_sku is required" };
    }
    if (!childSku) {
      return { ok: false, error: "child_sku is required" };
    }
    if (!quantity) {
      return { ok: false, error: "quantity must be a positive number" };
    }
    if (!scrapFactor) {
      return { ok: false, error: "scrap_factor must be a positive number" };
    }
    if (!BOM_UNITS.has(unitOfMeasure)) {
      return {
        ok: false,
        error:
          "unit_of_measure must be one of: in, yd, ea, lbs, ft, sqft, oz, gal",
      };
    }

    const db = getDb();

    const [parent] = await db
      .select({
        global_sku: sku_mappings.global_sku,
        item_type: sku_mappings.item_type,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, parentSku))
      .limit(1);

    if (!parent) {
      return { ok: false, error: `Parent SKU not found: ${parentSku}` };
    }
    if (!PRODUCIBLE.includes(parent.item_type)) {
      return {
        ok: false,
        error: `Parent must be finished_good or sub_assembly (got ${parent.item_type})`,
      };
    }

    const [child] = await db
      .select({
        global_sku: sku_mappings.global_sku,
        item_type: sku_mappings.item_type,
        original_name: sku_mappings.original_name,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, childSku))
      .limit(1);

    if (!child) {
      return { ok: false, error: `Child SKU not found: ${childSku}` };
    }
    if (!CHILD_ALLOWED.includes(child.item_type)) {
      return {
        ok: false,
        error: `Child must be raw_material or sub_assembly (got ${child.item_type})`,
      };
    }

    if (await wouldCreateCycle(parentSku, childSku)) {
      return { ok: false, error: "That link would create a BOM cycle" };
    }

    const now = new Date();

    if (data.id) {
      const [updated] = await db
        .update(product_bom)
        .set({
          child_sku: childSku,
          quantity,
          scrap_factor: scrapFactor,
          unit_of_measure: unitOfMeasure,
          updated_at: now,
        })
        .where(eq(product_bom.id, data.id))
        .returning();

      if (!updated) {
        return { ok: false, error: "BOM line not found" };
      }

      revalidateDictionary();
      return { ok: true, line: mapBomRow(updated, child) };
    }

    const [inserted] = await db
      .insert(product_bom)
      .values({
        parent_sku: parentSku,
        child_sku: childSku,
        quantity,
        scrap_factor: scrapFactor,
        unit_of_measure: unitOfMeasure,
        updated_at: now,
      })
      .returning();

    revalidateDictionary();
    return { ok: true, line: mapBomRow(inserted, child) };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown BOM save failure";
    return { ok: false, error: message };
  }
}

export async function deleteBOMLine(id: string): Promise<BomMutationResult> {
  try {
    const lineId = id.trim();
    if (!lineId) {
      return { ok: false, error: "id is required" };
    }

    const db = getDb();
    const [deleted] = await db
      .delete(product_bom)
      .where(eq(product_bom.id, lineId))
      .returning({ id: product_bom.id });

    if (!deleted) {
      return { ok: false, error: "BOM line not found" };
    }

    revalidateDictionary();
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown BOM delete failure";
    return { ok: false, error: message };
  }
}

export async function getItemOperations(
  itemSku: string,
): Promise<ItemOperationRow[]> {
  const sku = itemSku.trim().toUpperCase();
  if (!sku) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(item_operations)
    .where(eq(item_operations.item_sku, sku))
    .orderBy(asc(item_operations.sequence), asc(item_operations.work_center));
  return rows.map(mapOperationRow);
}

export async function upsertItemOperation(
  data: UpsertItemOperationInput,
): Promise<{ ok: true; row: ItemOperationRow } | { ok: false; error: string }> {
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
        .update(item_operations)
        .set({
          work_center: workCenter,
          sequence: Math.trunc(sequence),
          setup_time_mins: setup,
          run_time_mins: run,
          updated_at: now,
        })
        .where(eq(item_operations.id, data.id))
        .returning();
      if (!updated) return { ok: false, error: "Operation not found" };
      revalidateDictionary();
      return { ok: true, row: mapOperationRow(updated) };
    }

    const [inserted] = await db
      .insert(item_operations)
      .values({
        item_sku: itemSku,
        work_center: workCenter,
        sequence: Math.trunc(sequence),
        setup_time_mins: setup,
        run_time_mins: run,
        updated_at: now,
      })
      .returning();

    revalidateDictionary();
    return { ok: true, row: mapOperationRow(inserted) };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown operation save failure";
    return { ok: false, error: message };
  }
}

export async function deleteItemOperation(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const lineId = id.trim();
    if (!lineId) return { ok: false, error: "id is required" };
    const db = getDb();
    const [deleted] = await db
      .delete(item_operations)
      .where(eq(item_operations.id, lineId))
      .returning({ id: item_operations.id });
    if (!deleted) return { ok: false, error: "Operation not found" };
    revalidateDictionary();
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown operation delete failure";
    return { ok: false, error: message };
  }
}

function textField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value: string): string | null {
  return value.length > 0 ? value : null;
}

/** Strip currency formatting so QBO/downstream parsers get plain numbers. */
function sanitizeMsrp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeFileName(sku: string, file: File): string {
  const rawExt = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1)
    : "bin";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
  const safeSku = sku.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safeSku}-${Date.now()}.${ext}`;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function collectionFromName(originalName: string): string {
  const trimmed = originalName.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

function isFinishedGoodCategory(category: string): boolean {
  return category.trim().toLowerCase() === "finished good";
}

const DUPLICATE_SKU_COLLISION = {
  ok: false as const,
  error: "DUPLICATE_SKU_COLLISION",
  message:
    "This combination of dimensions and category generates a SKU that already exists.",
};

async function findSkuCollision(
  newSku: string,
  globalSku: string,
  originalName: string,
): Promise<SaveCatalogResult | null> {
  const db = getDb();
  const [existing] = await db
    .select({
      global_sku: sku_mappings.global_sku,
      original_name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, newSku))
    .limit(1);

  if (!existing) {
    return null;
  }

  if (existing.global_sku === globalSku) {
    return null;
  }

  if (existing.original_name.trim() !== originalName.trim()) {
    return DUPLICATE_SKU_COLLISION;
  }

  return null;
}

export async function saveCatalogDraft(
  formData: FormData,
): Promise<SaveCatalogResult> {
  try {
    const globalSku = textField(formData, "global_sku");
    const category = textField(formData, "category");
    const originalName = textField(formData, "original_name");
    const msrp = sanitizeMsrp(textField(formData, "msrp"));
    const cost = nullable(textField(formData, "cost"));
    const length = nullable(textField(formData, "length"));
    const depth = nullable(textField(formData, "depth"));
    const height = nullable(textField(formData, "height"));
    const armHeight = nullable(textField(formData, "arm_height"));
    const sitHeight = nullable(textField(formData, "sit_height"));
    const weight = nullable(textField(formData, "weight"));
    const description = nullable(textField(formData, "description"));
    const qboItemCode = nullable(textField(formData, "qbo_item_code"));
    const updatedBy = nullable(textField(formData, "updated_by")) ?? "dictionary";

    if (!globalSku) {
      return { ok: false, error: "global_sku is required" };
    }
    if (!category) {
      return { ok: false, error: "category is required" };
    }

    const memo = [description, originalName].filter(Boolean).join(" ");
    const collection = collectionFromName(originalName);
    const newSku = isFinishedGoodCategory(category)
      ? generateFinishedGoodSku(
          memo,
          collection,
          length ?? "",
          depth ?? "",
        )
      : globalSku;

    const targetSku = newSku !== globalSku ? newSku : globalSku;

    if (newSku !== globalSku) {
      const collision = await findSkuCollision(newSku, globalSku, originalName);
      if (collision) {
        return collision;
      }
    }

    let imageUrl: string | null = null;
    const imageEntry = formData.get("image");
    if (imageEntry instanceof File && imageEntry.size > 0) {
      if (!imageEntry.type.startsWith("image/")) {
        return { ok: false, error: "Only image uploads are allowed" };
      }

      const supabase = getSupabaseAdmin();
      const fileName = sanitizeFileName(targetSku, imageEntry);
      const body = Buffer.from(await imageEntry.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, body, {
          upsert: true,
          contentType: imageEntry.type || "application/octet-stream",
        });

      if (uploadError) {
        return {
          ok: false,
          error: `Storage upload failed: ${uploadError.message}`,
        };
      }

      const { data: publicData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(fileName);
      imageUrl = publicData.publicUrl;
    }

    const db = getDb();

    await db.transaction(async (tx) => {
      if (newSku !== globalSku) {
        const [existingMapping] = await tx
          .select()
          .from(sku_mappings)
          .where(eq(sku_mappings.global_sku, globalSku))
          .limit(1);

        if (!existingMapping) {
          throw new Error(`SKU not found: ${globalSku}`);
        }

        const [conflict] = await tx
          .select({
            global_sku: sku_mappings.global_sku,
            original_name: sku_mappings.original_name,
          })
          .from(sku_mappings)
          .where(eq(sku_mappings.global_sku, newSku))
          .limit(1);

        if (
          conflict &&
          conflict.global_sku !== globalSku &&
          conflict.original_name.trim() !== originalName.trim()
        ) {
          throw new Error("DUPLICATE_SKU_COLLISION");
        }

        const [existingCatalog] = await tx
          .select()
          .from(finished_goods_catalog)
          .where(eq(finished_goods_catalog.global_sku, globalSku))
          .limit(1);

        if (existingCatalog) {
          await tx
            .update(finished_goods_catalog)
            .set({
              msrp: msrp ?? existingCatalog.msrp ?? null,
              cost: cost ?? existingCatalog.cost ?? null,
              length: length ?? existingCatalog.length ?? null,
              depth: depth ?? existingCatalog.depth ?? null,
              height: height ?? existingCatalog.height ?? null,
              arm_height: armHeight ?? existingCatalog.arm_height ?? null,
              sit_height: sitHeight ?? existingCatalog.sit_height ?? null,
              weight: weight ?? existingCatalog.weight ?? null,
              description: description ?? existingCatalog.description ?? null,
              qbo_item_code: qboItemCode ?? existingCatalog.qbo_item_code ?? null,
              updated_by: updatedBy,
              ...(imageUrl ? { image_url: imageUrl } : {}),
              updated_at: new Date(),
            })
            .where(eq(finished_goods_catalog.global_sku, globalSku));
        } else {
          await tx.insert(finished_goods_catalog).values({
            global_sku: globalSku,
            msrp,
            cost,
            length,
            depth,
            height,
            arm_height: armHeight,
            sit_height: sitHeight,
            weight,
            description,
            qbo_item_code: qboItemCode,
            image_url: imageUrl,
            updated_by: updatedBy,
          });
        }

        await tx
          .update(sku_mappings)
          .set({
            global_sku: newSku,
            category,
            updated_by: updatedBy,
            updated_at: new Date(),
          })
          .where(eq(sku_mappings.global_sku, globalSku));

        await tx
          .insert(sku_aliases)
          .values({
            alias_sku: globalSku,
            canonical_sku: newSku,
            reason: "pim_catalog_save",
          })
          .onConflictDoNothing();
      } else {
        await tx
          .update(sku_mappings)
          .set({
            category,
            updated_by: updatedBy,
            updated_at: new Date(),
          })
          .where(eq(sku_mappings.global_sku, globalSku));

        await tx
          .insert(finished_goods_catalog)
          .values({
            global_sku: globalSku,
            msrp,
            cost,
            length,
            depth,
            height,
            arm_height: armHeight,
            sit_height: sitHeight,
            weight,
            description,
            qbo_item_code: qboItemCode,
            image_url: imageUrl,
            updated_by: updatedBy,
          })
          .onConflictDoUpdate({
            target: finished_goods_catalog.global_sku,
            set: {
              msrp,
              cost,
              length,
              depth,
              height,
              arm_height: armHeight,
              sit_height: sitHeight,
              weight,
              description,
              qbo_item_code: qboItemCode,
              updated_by: updatedBy,
              ...(imageUrl ? { image_url: imageUrl } : {}),
              updated_at: new Date(),
            },
          });
      }
    });

    revalidateDictionary();
    return { ok: true, imageUrl, newSku: targetSku };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "DUPLICATE_SKU_COLLISION") {
      return DUPLICATE_SKU_COLLISION;
    }
    const message =
      error instanceof Error ? error.message : "Unknown save failure";
    return { ok: false, error: message };
  }
}

export type KatanaSyncActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function syncFinishedGoodToKatanaAction(
  sku: string,
): Promise<KatanaSyncActionResult> {
  const result = await syncFinishedGoodToKatana(sku);
  if (result.ok) {
    revalidateDictionary();
    return { ok: true, message: result.message };
  }
  return { ok: false, error: result.error };
}

export async function syncBOMToKatanaAction(
  finishedGoodSku: string,
): Promise<KatanaSyncActionResult> {
  const result = await syncBOMToKatana(finishedGoodSku);
  if (result.ok) {
    revalidateDictionary();
    return { ok: true, message: result.message };
  }
  return { ok: false, error: result.error };
}

const ALLOWED_NA_FIELDS = new Set([
  "msrp",
  "length",
  "depth",
  "height",
  "arm_height",
  "sit_height",
  "weight",
  "image",
]);

export type SetFieldNaResult =
  | { ok: true; naFields: string[] }
  | { ok: false; error: string };

/**
 * Mark (or unmark) a PIM health field as Not Applicable for a finished good.
 * Satisfies dictionary "Missing Data" validation without inventing fake dims.
 */
export async function setCatalogFieldNotApplicable(
  sku: string,
  field: string,
  notApplicable: boolean,
): Promise<SetFieldNaResult> {
  const globalSku = sku.trim();
  const fieldKey = field.trim().toLowerCase();

  if (!globalSku) {
    return { ok: false, error: "SKU is required" };
  }
  if (!ALLOWED_NA_FIELDS.has(fieldKey)) {
    return { ok: false, error: `Field ${field} cannot be marked N/A` };
  }

  try {
    const db = getDb();
    const [existing] = await db
      .select({
        global_sku: finished_goods_catalog.global_sku,
        na_fields: finished_goods_catalog.na_fields,
      })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, globalSku))
      .limit(1);

    const current = new Set(
      Array.isArray(existing?.na_fields) ? existing.na_fields : [],
    );

    if (notApplicable) {
      current.add(fieldKey);
    } else {
      current.delete(fieldKey);
    }

    const naFields = Array.from(current).sort();
    const now = new Date();
    const operator = await resolvePimOperator();

    if (existing) {
      await db
        .update(finished_goods_catalog)
        .set({ na_fields: naFields, updated_at: now, updated_by: operator.label })
        .where(eq(finished_goods_catalog.global_sku, globalSku));
    } else {
      await db.insert(finished_goods_catalog).values({
        global_sku: globalSku,
        na_fields: naFields,
        updated_at: now,
        updated_by: operator.label,
      });
    }

    await db
      .update(sku_mappings)
      .set({ updated_at: now, updated_by: operator.label })
      .where(eq(sku_mappings.global_sku, globalSku));

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku,
      action: notApplicable ? "mark_na" : "clear_na",
      field: fieldKey,
      newValue: notApplicable ? "N/A" : "cleared",
    });

    revalidateDictionary();
    return { ok: true, naFields };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update N/A fields";
    return { ok: false, error: message };
  }
}

/**
 * Persist inferred N/A flags for finished goods where dims are blank.
 * Idempotent — only adds fields not already in na_fields.
 */
export async function seedSuggestedNaFields(
  skus: string[],
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (skus.length === 0) return { ok: true, updated: 0 };

  try {
    const { inferSuggestedNaFields } = await import("./pim-catalog-utils");
    const db = getDb();
    let updated = 0;

    for (const rawSku of skus) {
      const globalSku = rawSku.trim();
      if (!globalSku) continue;

      const [row] = await db
        .select({
          mapping: sku_mappings,
          catalog: finished_goods_catalog,
        })
        .from(sku_mappings)
        .leftJoin(
          finished_goods_catalog,
          eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
        )
        .where(eq(sku_mappings.global_sku, globalSku))
        .limit(1);

      if (!row) continue;
      const catKey = row.mapping.category.trim().toLowerCase();
      if (catKey !== "finished good" && row.mapping.item_type !== "finished_good") {
        continue;
      }

      const suggested = inferSuggestedNaFields({
        originalName: row.mapping.original_name,
        description: row.catalog?.description ?? null,
        globalSku,
      });
      if (suggested.length === 0) continue;

      const current = new Set(
        Array.isArray(row.catalog?.na_fields) ? row.catalog.na_fields : [],
      );
      let changed = false;
      for (const field of suggested) {
        if (!current.has(field)) {
          current.add(field);
          changed = true;
        }
      }
      if (!changed) continue;

      const naFields = Array.from(current).sort();
      if (row.catalog) {
        await db
          .update(finished_goods_catalog)
          .set({ na_fields: naFields, updated_at: new Date() })
          .where(eq(finished_goods_catalog.global_sku, globalSku));
      } else {
        await db.insert(finished_goods_catalog).values({
          global_sku: globalSku,
          na_fields: naFields,
          updated_at: new Date(),
        });
      }
      updated += 1;
    }

    if (updated > 0) {
      revalidateDictionary();
    }
    return { ok: true, updated };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to seed N/A fields";
    return { ok: false, error: message };
  }
}

const CATALOG_PATCH_FIELDS = new Set([
  "msrp",
  "cost",
  "length",
  "depth",
  "height",
  "arm_height",
  "sit_height",
  "weight",
  "description",
  "qbo_item_code",
]);

const MAPPING_PATCH_FIELDS = new Set([
  "category",
  "item_type",
  "woo_attribute_slug",
  "ghl_dropdown_value",
  "is_active",
  "sync_to_woo",
  "original_name",
  "uom_purchase",
  "uom_consume",
  "base_cost",
]);

export type InlinePatchResult =
  | {
      ok: true;
      updatedAt: string;
      updatedBy: string | null;
      version: number;
      naFields?: string[];
    }
  | {
      ok: false;
      error: string;
      field?: string;
      message?: string;
      code?: "VERSION_CONFLICT";
    };

function patchValidationError(
  field: string,
  message: string,
): InlinePatchResult {
  return { ok: false, error: message, field, message };
}

/**
 * Sheet-velocity field patch — does NOT regenerate Global SKU.
 * Dimension-driven SKU renames stay on full Save Changes in the expanded form.
 * Typing "N/A" on an allow-listed dim field appends to na_fields and clears the value.
 */
export async function patchCatalogField(input: {
  globalSku: string;
  field: string;
  value: string;
  updatedBy?: string;
}): Promise<InlinePatchResult> {
  const globalSku = input.globalSku.trim();
  const field = input.field.trim();
  const operator = await resolvePimOperator(input.updatedBy);

  if (!globalSku) {
    return { ok: false, error: "SKU is required" };
  }
  if (!CATALOG_PATCH_FIELDS.has(field)) {
    return { ok: false, error: `Field ${field} is not inline-editable` };
  }

  const raw = input.value.trim();
  const catalogValidation = validateCatalogFieldPatch(
    field,
    raw,
    ALLOWED_NA_FIELDS.has(field),
  );
  if (catalogValidation) {
    return patchValidationError(
      catalogValidation.field,
      catalogValidation.message,
    );
  }

  try {
    const db = getDb();
    const markNa = isNaToken(raw) && ALLOWED_NA_FIELDS.has(field);
    const value = markNa
      ? null
      : field === "msrp"
        ? sanitizeMsrp(raw)
        : nullable(raw);

    if (field === "msrp" && raw && !markNa && value === null) {
      return patchValidationError(field, "MSRP must be a valid number.");
    }

    const now = new Date();

    const [existing] = await db
      .select({
        global_sku: finished_goods_catalog.global_sku,
        na_fields: finished_goods_catalog.na_fields,
      })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, globalSku))
      .limit(1);

    const naSet = new Set(
      Array.isArray(existing?.na_fields) ? existing.na_fields : [],
    );
    if (ALLOWED_NA_FIELDS.has(field)) {
      if (markNa) {
        naSet.add(field);
      } else if (raw.length > 0) {
        naSet.delete(field);
      }
    }
    const naFields = Array.from(naSet).sort();

    const patch: Record<string, unknown> = {
      [field]: value,
      na_fields: naFields,
      updated_by: operator.label,
      updated_at: now,
    };

    if (existing) {
      await db
        .update(finished_goods_catalog)
        .set(patch)
        .where(eq(finished_goods_catalog.global_sku, globalSku));
    } else {
      await db.insert(finished_goods_catalog).values({
        global_sku: globalSku,
        ...patch,
      });
    }

    await db
      .update(sku_mappings)
      .set({ updated_by: operator.label, updated_at: now })
      .where(eq(sku_mappings.global_sku, globalSku));

    const [ver] = await db
      .select({ version: sku_mappings.version })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, globalSku))
      .limit(1);

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku,
      action: "patch_catalog",
      field,
      newValue: value ?? (markNa ? "N/A" : null),
    });

    return {
      ok: true,
      updatedAt: now.toISOString(),
      updatedBy: operator.label,
      version: ver?.version ?? 1,
      naFields,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Inline catalog save failed";
    try {
      const { sendOhCrapAlert } = await import("@/server/alerts/oh-crap");
      await sendOhCrapAlert({
        reason: "validation_failed",
        source: "system",
        externalId: globalSku,
        sku: globalSku,
        message,
        resolutionPath: `/admin/dictionary?sku=${encodeURIComponent(globalSku)}`,
      });
    } catch {
      // alert best-effort
    }
    return { ok: false, error: message };
  }
}

export async function patchMappingField(input: {
  globalSku: string;
  field: string;
  value: string | boolean;
  updatedBy?: string;
  expectedVersion?: number;
}): Promise<InlinePatchResult> {
  const globalSku = input.globalSku.trim();
  const field = input.field.trim();
  const operator = await resolvePimOperator(input.updatedBy);

  if (!globalSku) {
    return { ok: false, error: "SKU is required" };
  }
  if (!MAPPING_PATCH_FIELDS.has(field)) {
    return { ok: false, error: `Field ${field} is not inline-editable` };
  }

  if (typeof input.value !== "boolean") {
    const mappingValidation = validateMappingFieldPatch(field, input.value);
    if (mappingValidation) {
      return patchValidationError(
        mappingValidation.field,
        mappingValidation.message,
      );
    }
  }

  try {
    const db = getDb();
    const now = new Date();

    const [existing] = await db
      .select({
        version: sku_mappings.version,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, globalSku))
      .limit(1);

    if (!existing) {
      return { ok: false, error: `SKU not found: ${globalSku}` };
    }

    if (
      input.expectedVersion != null &&
      existing.version !== input.expectedVersion
    ) {
      return {
        ok: false,
        error: "Row was modified by another operator",
        code: "VERSION_CONFLICT",
      };
    }

    const nextVersion = existing.version + 1;
    const patch: Record<string, unknown> = {
      updated_by: operator.label,
      updated_at: now,
      version: nextVersion,
    };

    if (field === "is_active") {
      patch.is_active =
        typeof input.value === "boolean"
          ? input.value
          : String(input.value).toLowerCase() === "true";
    } else if (field === "sync_to_woo") {
      patch.sync_to_woo =
        typeof input.value === "boolean"
          ? input.value
          : String(input.value).toLowerCase() === "true";
    } else if (field === "category") {
      const category = String(input.value).trim();
      if (!category) {
        return { ok: false, error: "category is required" };
      }
      patch.category = category;
    } else if (field === "item_type") {
      const itemType = String(input.value).trim();
      const allowed = new Set([
        "raw_material",
        "sub_assembly",
        "finished_good",
        "service",
      ]);
      if (!allowed.has(itemType)) {
        return {
          ok: false,
          error:
            "item_type must be raw_material, sub_assembly, finished_good, or service",
        };
      }
      patch.item_type = itemType;
    } else if (field === "base_cost") {
      const raw = String(input.value).trim().replace(/[$,\s]/g, "");
      patch.base_cost = raw.length > 0 ? raw : null;
    } else {
      const text = String(input.value).trim();
      patch[field] = text.length > 0 ? text : null;
    }

    await db
      .update(sku_mappings)
      .set(patch)
      .where(eq(sku_mappings.global_sku, globalSku));

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku,
      action: "patch_mapping",
      field,
      newValue:
        typeof input.value === "boolean"
          ? String(input.value)
          : String(input.value),
    });

    return {
      ok: true,
      updatedAt: now.toISOString(),
      updatedBy: operator.label,
      version: nextVersion,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Inline mapping save failed";
    return { ok: false, error: message };
  }
}

/**
 * Patch a dotted path inside sku_mappings.attributes (category-specific JSONB).
 * Uses optimistic concurrency via expectedVersion when provided.
 */
export async function patchAttributeField(input: {
  globalSku: string;
  path: string;
  value: string;
  updatedBy?: string;
  expectedVersion?: number;
}): Promise<InlinePatchResult> {
  const globalSku = input.globalSku.trim();
  const path = input.path.trim();
  const operator = await resolvePimOperator(input.updatedBy);

  if (!globalSku) {
    return { ok: false, error: "SKU is required" };
  }
  if (!path) {
    return { ok: false, error: "Attribute path is required" };
  }

  try {
    const { parseCategoryAttributes, setAttributePath } = await import(
      "@/server/pim/attributes"
    );
    const db = getDb();

    const [existing] = await db
      .select({
        category: sku_mappings.category,
        attributes: sku_mappings.attributes,
        version: sku_mappings.version,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, globalSku))
      .limit(1);

    if (!existing) {
      return { ok: false, error: `SKU not found: ${globalSku}` };
    }

    if (
      input.expectedVersion != null &&
      existing.version !== input.expectedVersion
    ) {
      return {
        ok: false,
        error: "Row was modified by another operator",
        code: "VERSION_CONFLICT",
      };
    }

    const current = parseCategoryAttributes(
      existing.category,
      existing.attributes ?? {},
    );

    const attributeValidation = validateAttributeFieldPatch({
      category: existing.category,
      path,
      value: input.value,
      currentAttributes: current,
    });
    if (attributeValidation) {
      return patchValidationError(
        attributeValidation.field,
        attributeValidation.message,
      );
    }

    const now = new Date();
    const nextAttrs = setAttributePath(
      current,
      path,
      input.value.trim() === "" ? null : input.value.trim(),
    );
    const validated = parseCategoryAttributes(existing.category, nextAttrs);
    const nextVersion = existing.version + 1;

    await db
      .update(sku_mappings)
      .set({
        attributes: validated,
        version: nextVersion,
        updated_by: operator.label,
        updated_at: now,
      })
      .where(eq(sku_mappings.global_sku, globalSku));

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku,
      action: "patch_attribute",
      field: path,
      newValue: input.value.trim() || null,
    });

    return {
      ok: true,
      updatedAt: now.toISOString(),
      updatedBy: operator.label,
      version: nextVersion,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Attribute save failed";
    return { ok: false, error: message };
  }
}

export type SkuMappingInput = {
  sku?: string;
  name: string;
  category: string;
  itemType: ItemType;
  unitOfMeasure?: string;
  baseCost?: string;
  syncToWoo?: boolean;
};

export type SkuMutationResult =
  | { ok: true; row: import("./types").SkuMappingRow }
  | { ok: false; error: string };

function slugifySkuToken(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return slug || "ITEM";
}

function parseOptionalCost(raw?: string): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

async function loadTakenSkus(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ global_sku: sku_mappings.global_sku })
    .from(sku_mappings);
  return new Set(rows.map((row) => row.global_sku.trim().toUpperCase()));
}

/** Preview/auto SKU for the dictionary add form (client-side). */
export async function proposeSku(input: {
  category: string;
  name: string;
  itemType: ItemType;
  preferredSku?: string;
}): Promise<{ sku: string }> {
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name || !category) {
    return { sku: "" };
  }

  const taken = await loadTakenSkus();
  let base: string;
  if (input.preferredSku?.trim()) {
    base = input.preferredSku.trim().toUpperCase();
  } else if (
    input.itemType === "finished_good" ||
    isFinishedGoodCategory(category)
  ) {
    base = generateFinishedGoodSku(name, "", "", "");
  } else if (input.itemType === "raw_material") {
    base = buildRawMaterialSkuBase(category, name);
  } else if (input.itemType === "sub_assembly") {
    base = `SA-${slugifySkuToken(name)}`;
  } else {
    base = `SVC-${slugifySkuToken(name)}`;
  }
  return { sku: nextAvailableSku(base, taken) };
}

async function allocateSku(input: SkuMappingInput): Promise<string> {
  const taken = await loadTakenSkus();
  const manual = input.sku?.trim().toUpperCase() ?? "";
  if (manual) {
    return nextAvailableSku(manual, taken);
  }
  const { sku } = await proposeSku({
    category: input.category,
    name: input.name,
    itemType: input.itemType,
  });
  return sku;
}

async function fetchSkuMappingRowForTable(
  globalSku: string,
): Promise<import("./types").SkuMappingRow | null> {
  const needle = globalSku.trim();
  if (!needle) return null;

  const db = getDb();
  const [row] = await db
    .select({
      mapping: sku_mappings,
      catalog: finished_goods_catalog,
      bomCount: sql<number>`coalesce((
        select count(*)::int from product_bom pb
        where pb.parent_sku = ${sku_mappings.global_sku}
      ), 0)`.mapWith(Number),
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (!row) return null;

  const { mapping, catalog, bomCount } = row;
  return {
    globalSku: mapping.global_sku,
    category: mapping.category,
    itemType: mapping.item_type,
    originalName: mapping.original_name,
    sourceFile: mapping.source_file,
    isActive: mapping.is_active,
    syncToWoo: mapping.sync_to_woo,
    uomPurchase: mapping.uom_purchase,
    uomConsume: mapping.uom_consume,
    baseCost: mapping.base_cost,
    katanaVariantId: mapping.katana_variant_id,
    katanaMaterialId: mapping.katana_material_id,
    wooAttributeSlug: mapping.woo_attribute_slug,
    ghlDropdownValue: mapping.ghl_dropdown_value,
    qboAccounts: mapping.qbo_accounts ?? {},
    attributes:
      mapping.attributes && typeof mapping.attributes === "object"
        ? (mapping.attributes as Record<string, unknown>)
        : {},
    version: mapping.version ?? 1,
    mappingUpdatedAt: mapping.updated_at?.toISOString?.() ?? null,
    mappingUpdatedBy: mapping.updated_by,
    bomComponentCount: Number(bomCount) || 0,
    catalog: catalog
      ? {
          msrp: catalog.msrp,
          cost: catalog.cost,
          length: catalog.length,
          depth: catalog.depth,
          height: catalog.height,
          armHeight: catalog.arm_height,
          sitHeight: catalog.sit_height,
          weight: catalog.weight,
          description: catalog.description,
          imageUrl: catalog.image_url,
          qboItemCode: catalog.qbo_item_code,
          naFields: Array.isArray(catalog.na_fields) ? catalog.na_fields : [],
          updatedAt: catalog.updated_at.toISOString(),
          updatedBy: catalog.updated_by,
        }
      : null,
  };
}

export async function createSkuMapping(
  input: SkuMappingInput,
): Promise<SkuMutationResult> {
  const parsed = skuMappingCreateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Invalid SKU input" };
  }

  const data = parsed.data;
  if (data.baseCost?.trim()) {
    const costError = validateRawMaterialCost(data.baseCost);
    if (costError) {
      return { ok: false, error: costError.message };
    }
  }

  try {
    const sku = await allocateSku({
      sku: data.sku,
      name: data.name,
      category: data.category,
      itemType: data.itemType,
      unitOfMeasure: data.unitOfMeasure,
      baseCost: data.baseCost,
      syncToWoo: data.syncToWoo,
    });
    const name = data.name.trim();
    const category = data.category.trim();
    const uom = (data.unitOfMeasure?.trim() || "ea").toLowerCase();
    const cost = parseOptionalCost(data.baseCost);
    const syncToWoo = data.syncToWoo ?? false;
    const now = new Date();
    const operator = await resolvePimOperator();

    const db = getDb();
    const [existing] = await db
      .select({ global_sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    if (existing) {
      return { ok: false, error: `SKU ${sku} already exists in the global catalog` };
    }

    await db.transaction(async (tx) => {
      await tx.insert(sku_mappings).values({
        global_sku: sku,
        category,
        item_type: data.itemType,
        original_name: name,
        source_file: "sku-dictionary",
        is_active: true,
        sync_to_woo: syncToWoo,
        uom_purchase: uom,
        uom_consume: uom,
        base_cost: cost,
        attributes: {},
        version: 1,
        updated_by: operator.label,
        updated_at: now,
      });

      if (
        data.itemType === "finished_good" ||
        isFinishedGoodCategory(category)
      ) {
        await tx.insert(finished_goods_catalog).values({
          global_sku: sku,
          updated_by: operator.label,
        });
      }

      if (data.itemType === "raw_material") {
        await tx.insert(raw_materials_catalog).values({
          sku,
          name,
          category,
          unit_of_measure: uom,
          cost_per_unit: cost,
          updated_at: now,
        });
      }
    });

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku: sku,
      action: "create_sku",
      field: "global_sku",
      newValue: sku,
    });

    revalidateDictionary();
    revalidatePath("/admin/raw-materials");

    const row = await fetchSkuMappingRowForTable(sku);
    if (!row) {
      return { ok: false, error: "SKU created but failed to load row" };
    }
    return { ok: true, row };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create SKU";
    if (message.includes("unique") || message.includes("duplicate")) {
      return { ok: false, error: "SKU already exists in the global catalog" };
    }
    return { ok: false, error: message };
  }
}

export async function deleteSkuMapping(
  sku: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "SKU is required" };
  }

  try {
    const db = getDb();
    const [bomRef] = await db
      .select({ id: product_bom.id })
      .from(product_bom)
      .where(
        or(
          eq(product_bom.child_sku, needle),
          eq(product_bom.parent_sku, needle),
        ),
      )
      .limit(1);

    if (bomRef) {
      return {
        ok: false,
        error: "Cannot delete: this SKU is referenced in a Bill of Materials.",
      };
    }

    const operator = await resolvePimOperator();

    await db.transaction(async (tx) => {
      await tx
        .delete(sku_aliases)
        .where(
          or(
            eq(sku_aliases.alias_sku, needle),
            eq(sku_aliases.canonical_sku, needle),
          ),
        );
      await tx
        .delete(finished_goods_catalog)
        .where(eq(finished_goods_catalog.global_sku, needle));
      await tx
        .delete(raw_materials_catalog)
        .where(eq(raw_materials_catalog.sku, needle));
      await tx.delete(sku_mappings).where(eq(sku_mappings.global_sku, needle));
    });

    await logPimAudit({
      operatorEmail: operator.email,
      globalSku: needle,
      action: "delete_sku",
      field: "global_sku",
      newValue: null,
    });

    revalidateDictionary();
    revalidatePath("/admin/raw-materials");
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to delete SKU";
    return { ok: false, error: message };
  }
}

export type PimDeltaRow = {
  globalSku: string;
  category: string;
  originalName: string;
  isActive: boolean;
  syncToWoo?: boolean;
  itemType?: import("@/server/db/schema").ItemType;
  uomPurchase?: string | null;
  uomConsume?: string | null;
  baseCost?: string | null;
  attributes?: Record<string, unknown>;
  version?: number;
  katanaVariantId: number | null;
  katanaMaterialId: number | null;
  wooAttributeSlug: string | null;
  ghlDropdownValue: string | null;
  mappingUpdatedAt: string | null;
  mappingUpdatedBy: string | null;
  catalog: {
    msrp: string | null;
    cost: string | null;
    length: string | null;
    depth: string | null;
    height: string | null;
    armHeight: string | null;
    sitHeight: string | null;
    weight: string | null;
    description: string | null;
    imageUrl: string | null;
    qboItemCode: string | null;
    naFields: string[];
    updatedAt: string;
    updatedBy: string | null;
  } | null;
};

/** Lightweight poll fallback when Realtime anon key is unset. */
export async function fetchPimDeltas(sinceIso: string): Promise<PimDeltaRow[]> {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) {
    return [];
  }

  const db = getDb();
  const { or, gt } = await import("drizzle-orm");

  const rows = await db
    .select({
      mapping: sku_mappings,
      catalog: finished_goods_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(
      or(
        gt(sku_mappings.updated_at, since),
        gt(finished_goods_catalog.updated_at, since),
      ),
    )
    .limit(500);

  return rows.map(({ mapping, catalog }) => ({
    globalSku: mapping.global_sku,
    category: mapping.category,
    originalName: mapping.original_name,
    isActive: mapping.is_active,
    syncToWoo: mapping.sync_to_woo,
    itemType: mapping.item_type,
    uomPurchase: mapping.uom_purchase,
    uomConsume: mapping.uom_consume,
    baseCost: mapping.base_cost,
    attributes:
      mapping.attributes && typeof mapping.attributes === "object"
        ? (mapping.attributes as Record<string, unknown>)
        : {},
    version: mapping.version,
    katanaVariantId: mapping.katana_variant_id,
    katanaMaterialId: mapping.katana_material_id,
    wooAttributeSlug: mapping.woo_attribute_slug,
    ghlDropdownValue: mapping.ghl_dropdown_value,
    mappingUpdatedAt: mapping.updated_at?.toISOString?.() ?? null,
    mappingUpdatedBy: mapping.updated_by,
    catalog: catalog
      ? {
          msrp: catalog.msrp,
          cost: catalog.cost,
          length: catalog.length,
          depth: catalog.depth,
          height: catalog.height,
          armHeight: catalog.arm_height,
          sitHeight: catalog.sit_height,
          weight: catalog.weight,
          description: catalog.description,
          imageUrl: catalog.image_url,
          qboItemCode: catalog.qbo_item_code,
          naFields: Array.isArray(catalog.na_fields) ? catalog.na_fields : [],
          updatedAt: catalog.updated_at.toISOString(),
          updatedBy: catalog.updated_by,
        }
      : null,
  }));
}

/** Fetch one SKU row with catalog — used by Realtime handlers for full sync. */
export async function fetchPimRow(
  globalSku: string,
): Promise<PimDeltaRow | null> {
  const sku = globalSku.trim();
  if (!sku) return null;

  const db = getDb();
  const [row] = await db
    .select({
      mapping: sku_mappings,
      catalog: finished_goods_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!row) return null;
  const { mapping, catalog } = row;
  return {
    globalSku: mapping.global_sku,
    category: mapping.category,
    originalName: mapping.original_name,
    isActive: mapping.is_active,
    syncToWoo: mapping.sync_to_woo,
    itemType: mapping.item_type,
    uomPurchase: mapping.uom_purchase,
    uomConsume: mapping.uom_consume,
    baseCost: mapping.base_cost,
    attributes:
      mapping.attributes && typeof mapping.attributes === "object"
        ? (mapping.attributes as Record<string, unknown>)
        : {},
    version: mapping.version,
    katanaVariantId: mapping.katana_variant_id,
    katanaMaterialId: mapping.katana_material_id,
    wooAttributeSlug: mapping.woo_attribute_slug,
    ghlDropdownValue: mapping.ghl_dropdown_value,
    mappingUpdatedAt: mapping.updated_at?.toISOString?.() ?? null,
    mappingUpdatedBy: mapping.updated_by,
    catalog: catalog
      ? {
          msrp: catalog.msrp,
          cost: catalog.cost,
          length: catalog.length,
          depth: catalog.depth,
          height: catalog.height,
          armHeight: catalog.arm_height,
          sitHeight: catalog.sit_height,
          weight: catalog.weight,
          description: catalog.description,
          imageUrl: catalog.image_url,
          qboItemCode: catalog.qbo_item_code,
          naFields: Array.isArray(catalog.na_fields) ? catalog.na_fields : [],
          updatedAt: catalog.updated_at.toISOString(),
          updatedBy: catalog.updated_by,
        }
      : null,
  };
}
