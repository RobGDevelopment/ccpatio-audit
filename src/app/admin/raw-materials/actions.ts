"use server";

import {
  and,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncRawMaterialToKatana } from "@/lib/katana";
import { getDb } from "@/server/db/client";
import {
  product_bom,
  raw_materials_catalog,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";

export type RawMaterialRow = {
  catalogId: string | null;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPerUnit: string | null;
  isActive: boolean;
  version: number;
  mappingUpdatedAt: string | null;
  catalogUpdatedAt: string | null;
};

export type RawMaterialInput = {
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPerUnit?: string;
};

export type RawMaterialMutationResult =
  | { ok: true; material?: RawMaterialRow }
  | { ok: false; error: string };

const UNIT_OPTIONS = new Set([
  "ea",
  "in",
  "yd",
  "ft",
  "lbs",
  "sqft",
  "oz",
  "gal",
]);

const RAW_ITEM_TYPES: ItemType[] = ["raw_material", "sub_assembly"];

function parseCost(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function validateInput(input: RawMaterialInput): string | null {
  if (!input.sku.trim()) {
    return "SKU is required";
  }
  if (!input.name.trim()) {
    return "Name is required";
  }
  if (!input.category.trim()) {
    return "Category is required";
  }
  const uom = input.unitOfMeasure.trim().toLowerCase();
  if (!UNIT_OPTIONS.has(uom)) {
    return "Invalid unit of measure";
  }
  if (input.costPerUnit !== undefined && parseCost(input.costPerUnit) === null) {
    return "Cost must be a valid number";
  }
  return null;
}

function mapJoinedRow(
  mapping: typeof sku_mappings.$inferSelect | null,
  catalog: typeof raw_materials_catalog.$inferSelect | null,
): RawMaterialRow | null {
  const sku = (catalog?.sku ?? mapping?.global_sku)?.trim().toUpperCase();
  if (!sku) {
    return null;
  }

  return {
    catalogId: catalog?.id ?? null,
    sku,
    name: mapping?.original_name?.trim() || catalog?.name?.trim() || sku,
    category:
      mapping?.category?.trim() || catalog?.category?.trim() || "Uncategorized",
    unitOfMeasure:
      catalog?.unit_of_measure?.trim().toLowerCase() ||
      mapping?.uom_consume?.trim().toLowerCase() ||
      mapping?.uom_purchase?.trim().toLowerCase() ||
      "ea",
    costPerUnit: catalog?.cost_per_unit ?? mapping?.base_cost ?? null,
    isActive: mapping?.is_active ?? true,
    version: mapping?.version ?? 1,
    mappingUpdatedAt: mapping?.updated_at?.toISOString?.() ?? null,
    catalogUpdatedAt: catalog?.updated_at?.toISOString?.() ?? null,
  };
}

function sortRows(rows: RawMaterialRow[]): RawMaterialRow[] {
  return [...rows].sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    if (cat !== 0) return cat;
    return a.sku.localeCompare(b.sku);
  });
}

function mergeRows(rows: RawMaterialRow[]): RawMaterialRow[] {
  const bySku = new Map<string, RawMaterialRow>();
  for (const row of rows) {
    const existing = bySku.get(row.sku);
    if (!existing) {
      bySku.set(row.sku, row);
      continue;
    }
    bySku.set(row.sku, {
      ...existing,
      ...row,
      catalogId: row.catalogId ?? existing.catalogId,
      name: row.name || existing.name,
      category: row.category || existing.category,
      unitOfMeasure: row.unitOfMeasure || existing.unitOfMeasure,
      costPerUnit: row.costPerUnit ?? existing.costPerUnit,
      version: Math.max(row.version, existing.version),
    });
  }
  return sortRows([...bySku.values()]);
}

async function fetchJoinedRows(): Promise<RawMaterialRow[]> {
  const db = getDb();

  const catalogJoined = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(raw_materials_catalog)
    .leftJoin(
      sku_mappings,
      eq(raw_materials_catalog.sku, sku_mappings.global_sku),
    )
    .orderBy(asc(raw_materials_catalog.category), asc(raw_materials_catalog.sku));

  const mappingOnly = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      raw_materials_catalog,
      eq(sku_mappings.global_sku, raw_materials_catalog.sku),
    )
    .where(
      and(
        inArray(sku_mappings.item_type, RAW_ITEM_TYPES),
        isNull(raw_materials_catalog.id),
      ),
    )
    .orderBy(asc(sku_mappings.category), asc(sku_mappings.global_sku));

  const mapped = [...catalogJoined, ...mappingOnly]
    .map(({ mapping, catalog }) => mapJoinedRow(mapping, catalog))
    .filter((row): row is RawMaterialRow => row !== null);

  return mergeRows(mapped);
}

export async function fetchAllRawMaterials(): Promise<RawMaterialRow[]> {
  return fetchJoinedRows();
}

export async function fetchRawMaterialBySku(
  sku: string,
): Promise<RawMaterialRow | null> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    return null;
  }

  const db = getDb();
  const [row] = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      raw_materials_catalog,
      eq(sku_mappings.global_sku, raw_materials_catalog.sku),
    )
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (row) {
    return mapJoinedRow(row.mapping, row.catalog);
  }

  const [catalogRow] = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(raw_materials_catalog)
    .leftJoin(
      sku_mappings,
      eq(raw_materials_catalog.sku, sku_mappings.global_sku),
    )
    .where(eq(raw_materials_catalog.sku, needle))
    .limit(1);

  return catalogRow
    ? mapJoinedRow(catalogRow.mapping, catalogRow.catalog)
    : null;
}

/** Poll fallback when Realtime is unavailable. */
export async function fetchRawMaterialDeltas(
  sinceIso: string,
): Promise<RawMaterialRow[]> {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      raw_materials_catalog,
      eq(sku_mappings.global_sku, raw_materials_catalog.sku),
    )
    .where(
      and(
        inArray(sku_mappings.item_type, RAW_ITEM_TYPES),
        or(
          gt(sku_mappings.updated_at, since),
          gt(raw_materials_catalog.updated_at, since),
        ),
      ),
    )
    .limit(500);

  const catalogOnly = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(raw_materials_catalog)
    .leftJoin(
      sku_mappings,
      eq(raw_materials_catalog.sku, sku_mappings.global_sku),
    )
    .where(
      and(
        isNull(sku_mappings.global_sku),
        gt(raw_materials_catalog.updated_at, since),
      ),
    )
    .limit(200);

  return mergeRows(
    [...rows, ...catalogOnly]
      .map(({ mapping, catalog }) => mapJoinedRow(mapping, catalog))
      .filter((row): row is RawMaterialRow => row !== null),
  );
}

export async function listRawMaterials(query = ""): Promise<RawMaterialRow[]> {
  const needle = query.trim();
  if (!needle) {
    return fetchAllRawMaterials();
  }

  const pattern = `%${needle}%`;
  const db = getDb();
  const rows = await db
    .select({
      mapping: sku_mappings,
      catalog: raw_materials_catalog,
    })
    .from(raw_materials_catalog)
    .leftJoin(
      sku_mappings,
      eq(raw_materials_catalog.sku, sku_mappings.global_sku),
    )
    .where(
      or(
        ilike(raw_materials_catalog.sku, pattern),
        ilike(raw_materials_catalog.name, pattern),
        ilike(raw_materials_catalog.category, pattern),
        ilike(sku_mappings.original_name, pattern),
      ),
    )
    .orderBy(asc(raw_materials_catalog.sku))
    .limit(100);

  return mergeRows(
    rows
      .map(({ mapping, catalog }) => mapJoinedRow(mapping, catalog))
      .filter((row): row is RawMaterialRow => row !== null),
  );
}

/** Lightweight picker feed for BOM combobox. */
export async function searchRawMaterials(query = ""): Promise<RawMaterialRow[]> {
  return listRawMaterials(query);
}

function revalidatePimPaths(): void {
  revalidatePath("/admin/raw-materials");
  revalidatePath("/admin/dictionary");
}

async function upsertMappingAndCatalog(
  input: RawMaterialInput,
  existingVersion?: number,
): Promise<RawMaterialRow> {
  const db = getDb();
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim();
  const category = input.category.trim();
  const uom = input.unitOfMeasure.trim().toLowerCase();
  const cost = parseCost(input.costPerUnit);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [mapping] = await tx
      .insert(sku_mappings)
      .values({
        global_sku: sku,
        category,
        item_type: "raw_material",
        original_name: name,
        source_file: "raw-materials-catalog",
        is_active: true,
        uom_purchase: uom,
        uom_consume: uom,
        base_cost: cost,
        version: 1,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: sku_mappings.global_sku,
        set: {
          category,
          original_name: name,
          item_type: sql`'raw_material'::item_type`,
          uom_purchase: uom,
          uom_consume: uom,
          base_cost: cost,
          version:
            existingVersion !== undefined
              ? existingVersion + 1
              : sql`${sku_mappings.version} + 1`,
          updated_at: now,
        },
      })
      .returning();

    const [catalog] = await tx
      .insert(raw_materials_catalog)
      .values({
        sku,
        name,
        category,
        unit_of_measure: uom,
        cost_per_unit: cost,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: raw_materials_catalog.sku,
        set: {
          name,
          category,
          unit_of_measure: uom,
          cost_per_unit: cost,
          updated_at: now,
        },
      })
      .returning();

    const row = mapJoinedRow(mapping, catalog);
    if (!row) {
      throw new Error("Failed to map raw material row");
    }
    return row;
  });
}

export async function createRawMaterial(
  input: RawMaterialInput,
): Promise<RawMaterialMutationResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const material = await upsertMappingAndCatalog(input);
    revalidatePimPaths();
    return { ok: true, material };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create raw material";
    if (message.includes("unique") || message.includes("duplicate")) {
      return { ok: false, error: "SKU already exists" };
    }
    return { ok: false, error: message };
  }
}

export async function updateRawMaterial(
  sku: string,
  input: RawMaterialInput,
): Promise<RawMaterialMutationResult> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "SKU is required" };
  }

  const validationError = validateInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const existing = await fetchRawMaterialBySku(needle);
    const material = await upsertMappingAndCatalog(input, existing?.version);
    revalidatePimPaths();
    return { ok: true, material };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update raw material";
    return { ok: false, error: message };
  }
}

export async function patchRawMaterialInline(input: {
  sku: string;
  name?: string;
  costPerUnit?: string;
}): Promise<RawMaterialMutationResult> {
  const needle = input.sku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "SKU is required" };
  }

  const existing = await fetchRawMaterialBySku(needle);
  if (!existing) {
    return { ok: false, error: "Raw material not found" };
  }

  const nextName =
    input.name !== undefined ? input.name.trim() : existing.name;
  const nextCost =
    input.costPerUnit !== undefined
      ? input.costPerUnit
      : (existing.costPerUnit ?? "");

  if (!nextName) {
    return { ok: false, error: "Name is required" };
  }
  if (
    input.costPerUnit !== undefined &&
    parseCost(input.costPerUnit) === null
  ) {
    return { ok: false, error: "Cost must be a valid number" };
  }

  return updateRawMaterial(needle, {
    sku: needle,
    name: nextName,
    category: existing.category,
    unitOfMeasure: existing.unitOfMeasure,
    costPerUnit: nextCost,
  });
}

export async function deleteRawMaterial(
  sku: string,
): Promise<RawMaterialMutationResult> {
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

    await db.transaction(async (tx) => {
      await tx
        .delete(raw_materials_catalog)
        .where(eq(raw_materials_catalog.sku, needle));
      await tx
        .delete(sku_mappings)
        .where(eq(sku_mappings.global_sku, needle));
    });

    revalidatePimPaths();
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to delete raw material";
    return { ok: false, error: message };
  }
}

export type KatanaSyncActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function syncRawMaterialToKatanaAction(
  sku: string,
): Promise<KatanaSyncActionResult> {
  const result = await syncRawMaterialToKatana(sku);
  if (result.ok) {
    revalidatePimPaths();
    return { ok: true, message: result.message };
  }
  return { ok: false, error: result.error };
}
