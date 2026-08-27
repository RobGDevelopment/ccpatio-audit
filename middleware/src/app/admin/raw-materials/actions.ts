"use server";

import { asc, eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncRawMaterialToKatana } from "@/lib/katana";
import { getDb } from "@/server/db/client";
import { raw_materials_catalog } from "@/server/db/schema";

export type RawMaterialRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPerUnit: string | null;
  createdAt: Date;
  updatedAt: Date;
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

const UNIT_OPTIONS = new Set(["ea", "in", "yd", "ft", "lbs", "sqft", "oz", "gal"]);

function mapRow(row: typeof raw_materials_catalog.$inferSelect): RawMaterialRow {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unitOfMeasure: row.unit_of_measure,
    costPerUnit: row.cost_per_unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

export async function listRawMaterials(query = ""): Promise<RawMaterialRow[]> {
  const db = getDb();
  const needle = query.trim();

  if (!needle) {
    const rows = await db
      .select()
      .from(raw_materials_catalog)
      .orderBy(asc(raw_materials_catalog.category), asc(raw_materials_catalog.sku));
    return rows.map(mapRow);
  }

  const pattern = `%${needle}%`;
  const rows = await db
    .select()
    .from(raw_materials_catalog)
    .where(
      or(
        ilike(raw_materials_catalog.sku, pattern),
        ilike(raw_materials_catalog.name, pattern),
        ilike(raw_materials_catalog.category, pattern),
      ),
    )
    .orderBy(asc(raw_materials_catalog.sku))
    .limit(100);

  return rows.map(mapRow);
}

/** Lightweight picker feed for BOM combobox. */
export async function searchRawMaterials(query = ""): Promise<RawMaterialRow[]> {
  return listRawMaterials(query);
}

export async function createRawMaterial(
  input: RawMaterialInput,
): Promise<RawMaterialMutationResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const db = getDb();
    const [inserted] = await db
      .insert(raw_materials_catalog)
      .values({
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category.trim(),
        unit_of_measure: input.unitOfMeasure.trim().toLowerCase(),
        cost_per_unit: parseCost(input.costPerUnit),
        updated_at: new Date(),
      })
      .returning();

    revalidatePath("/admin/raw-materials");
    return { ok: true, material: mapRow(inserted) };
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
  id: string,
  input: RawMaterialInput,
): Promise<RawMaterialMutationResult> {
  const materialId = id.trim();
  if (!materialId) {
    return { ok: false, error: "id is required" };
  }

  const validationError = validateInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const db = getDb();
    const [updated] = await db
      .update(raw_materials_catalog)
      .set({
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category.trim(),
        unit_of_measure: input.unitOfMeasure.trim().toLowerCase(),
        cost_per_unit: parseCost(input.costPerUnit),
        updated_at: new Date(),
      })
      .where(eq(raw_materials_catalog.id, materialId))
      .returning();

    if (!updated) {
      return { ok: false, error: "Raw material not found" };
    }

    revalidatePath("/admin/raw-materials");
    return { ok: true, material: mapRow(updated) };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update raw material";
    if (message.includes("unique") || message.includes("duplicate")) {
      return { ok: false, error: "SKU already exists" };
    }
    return { ok: false, error: message };
  }
}

export async function deleteRawMaterial(
  id: string,
): Promise<RawMaterialMutationResult> {
  const materialId = id.trim();
  if (!materialId) {
    return { ok: false, error: "id is required" };
  }

  try {
    const db = getDb();
    const [deleted] = await db
      .delete(raw_materials_catalog)
      .where(eq(raw_materials_catalog.id, materialId))
      .returning({ id: raw_materials_catalog.id });

    if (!deleted) {
      return { ok: false, error: "Raw material not found" };
    }

    revalidatePath("/admin/raw-materials");
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
    revalidatePath("/admin/raw-materials");
    return { ok: true, message: result.message };
  }
  return { ok: false, error: result.error };
}
