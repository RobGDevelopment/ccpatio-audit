import { z } from "zod";
import {
  getAttributeSchema,
  setAttributePath,
} from "@/server/pim/attributes/schemas";
import { isAttributeValueComplete } from "@/server/pim/attributes/health";

export const itemTypeSchema = z.enum([
  "raw_material",
  "sub_assembly",
  "finished_good",
  "service",
]);

export const skuMappingCreateSchema = z.object({
  sku: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().min(1, "Category is required"),
  itemType: itemTypeSchema,
  unitOfMeasure: z.string().optional(),
  baseCost: z.string().optional(),
  syncToWoo: z.boolean().optional(),
});

export type PatchValidationError = {
  field: string;
  message: string;
};

const NUMERIC_CATALOG_FIELDS = new Set([
  "length",
  "depth",
  "height",
  "arm_height",
  "sit_height",
  "weight",
  "msrp",
  "cost",
]);

const NUMERIC_ATTRIBUTE_KEYS = new Set([
  "slab_length",
  "slab_width",
  "thickness_mm",
  "yield_sqft",
  "roll_width",
  "roll_width_in",
  "pattern_repeat",
  "rub_count",
  "wall_thickness",
  "wall_thick",
  "stock_length",
  "stick_len_in",
  "cure_temp",
  "cure_time",
]);

function isNaToken(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  return t === "n/a" || t === "na" || t === "n.a." || t === "n.a";
}

function isNumericString(raw: string): boolean {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return false;
  return /^\d+(\.\d+)?$/.test(cleaned);
}

export function validateCatalogFieldPatch(
  field: string,
  raw: string,
  allowNa: boolean,
): PatchValidationError | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (allowNa && isNaToken(trimmed)) {
    return null;
  }
  if (NUMERIC_CATALOG_FIELDS.has(field) && !isNumericString(trimmed)) {
    return {
      field,
      message: "Enter a valid number or mark N/A.",
    };
  }
  return null;
}

export function validateMappingFieldPatch(
  field: string,
  value: string | boolean,
): PatchValidationError | null {
  if (field === "original_name") {
    const name = String(value).trim();
    if (!name) {
      return { field, message: "Factory name is required." };
    }
  }
  if (field === "base_cost") {
    const raw = String(value).trim();
    if (raw && !isNumericString(raw)) {
      return { field, message: "Base cost must be a valid number." };
    }
  }
  if (field === "category") {
    if (!String(value).trim()) {
      return { field, message: "Category is required." };
    }
  }
  return null;
}

export function validateAttributeFieldPatch(input: {
  category: string;
  path: string;
  value: string;
  currentAttributes: Record<string, unknown>;
}): PatchValidationError | null {
  const trimmed = input.value.trim();
  if (!trimmed) {
    return null;
  }
  if (isNaToken(trimmed)) {
    return null;
  }

  const leaf = input.path.split(".").pop() ?? input.path;
  if (
    (NUMERIC_ATTRIBUTE_KEYS.has(input.path) ||
      NUMERIC_ATTRIBUTE_KEYS.has(leaf)) &&
    !isNumericString(trimmed)
  ) {
    return {
      field: input.path,
      message: "Enter a valid number or mark N/A.",
    };
  }

  const next = setAttributePath(
    { ...input.currentAttributes },
    input.path,
    trimmed,
  );
  const schema = getAttributeSchema(input.category);
  const parsed = schema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      field: input.path,
      message: issue?.message ?? "Invalid attribute value for this category.",
    };
  }

  if (!isAttributeValueComplete(trimmed)) {
    return null;
  }

  return null;
}

export function validateRawMaterialCost(raw: string): PatchValidationError | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isNumericString(trimmed)) {
    return { field: "base_cost", message: "Cost must be a valid number." };
  }
  return null;
}

/** Map server patch field id → modal descriptor key where they differ. */
export function patchFieldToModalKey(field: string): string {
  const map: Record<string, string> = {
    depth: "width",
    sit_height: "seat_height",
    arm_height: "arm_height",
    original_name: "original_name",
    base_cost: "base_cost",
    uom_purchase: "uom_purchase",
    uom_consume: "uom_consume",
    msrp: "msrp",
  };
  return map[field] ?? field;
}
