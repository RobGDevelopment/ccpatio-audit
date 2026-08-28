import { getAttributePath } from "./schemas";
import { normalizePimCategory } from "./schemas";

/** User-entered N/A bypasses missing-field alerts. */
export function isAttributeValueComplete(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  const normalized = t.toLowerCase().replace(/\s+/g, "");
  return (
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "n.a." ||
    normalized === "n.a"
  )
    ? true
    : t.length > 0;
}

export type RequiredAttributeField = {
  /** Stable key for health alerts / column id */
  key: string;
  /** Canonical write path + legacy read fallbacks */
  paths: string[];
};

/** Category-specific required attribute paths (management sprint). */
export const CATEGORY_REQUIRED_ATTRIBUTES: Record<
  string,
  RequiredAttributeField[]
> = {
  dekton: [
    { key: "slab_length", paths: ["slab_length", "slab_dims.l"] },
    { key: "slab_width", paths: ["slab_width", "slab_dims.w"] },
    { key: "thickness_mm", paths: ["thickness_mm"] },
    { key: "finish", paths: ["finish"] },
    { key: "yield_sqft", paths: ["yield_sqft"] },
  ],
  fabric: [
    { key: "grade", paths: ["grade", "fabric_grade"] },
    { key: "roll_width", paths: ["roll_width", "roll_width_in"] },
    {
      key: "pattern_repeat",
      paths: ["pattern_repeat", "pattern.repeat_v", "pattern.repeat_h"],
    },
    { key: "rub_count", paths: ["rub_count", "performance.double_rubs"] },
    { key: "colorway", paths: ["colorway", "pattern.colorway"] },
  ],
  metal: [
    { key: "profile_type", paths: ["profile_type"] },
    { key: "dimensions", paths: ["dimensions"] },
    { key: "wall_thickness", paths: ["wall_thickness", "wall_thick"] },
    { key: "alloy", paths: ["alloy", "alloy_temper"] },
    { key: "stock_length", paths: ["stock_length", "stick_len_in"] },
  ],
  powder: [
    { key: "finish_type", paths: ["finish_type", "brand_color.color_name"] },
    { key: "cure_temp", paths: ["cure_temp", "cure_schedule.temp_f"] },
    { key: "cure_time", paths: ["cure_time", "cure_schedule.time_min"] },
    { key: "ral_code", paths: ["ral_code"] },
  ],
};

export const FINISHED_GOOD_REQUIRED_CATALOG_FIELDS = [
  "length",
  "width",
  "height",
  "seat_height",
  "arm_height",
  "weight",
] as const;

export type FinishedGoodHealthField =
  (typeof FINISHED_GOOD_REQUIRED_CATALOG_FIELDS)[number];

/** Maps health key → finished_goods_catalog column */
export const FG_CATALOG_FIELD_READ: Record<
  FinishedGoodHealthField,
  (c: {
    length: string | null;
    depth: string | null;
    height: string | null;
    armHeight: string | null;
    sitHeight: string | null;
    weight: string | null;
    naFields: string[];
  }) => string | null | undefined
> = {
  length: (c) => c.length,
  width: (c) => c.depth,
  height: (c) => c.height,
  seat_height: (c) => c.sitHeight,
  arm_height: (c) => c.armHeight,
  weight: (c) => c.weight,
};

/** Maps health key → na_fields token in DB */
export const FG_CATALOG_NA_KEY: Record<FinishedGoodHealthField, string> = {
  length: "length",
  width: "depth",
  height: "height",
  seat_height: "sit_height",
  arm_height: "arm_height",
  weight: "weight",
};

export function normalizeCategoryForHealth(category: string): string {
  const key = normalizePimCategory(category);
  if (key === "powder coat" || key === "powdercoat") return "powder";
  if (key === "finished good" || key === "finished goods") return "finished good";
  if (key === "aluminum") return "metal";
  return key;
}

export function resolveAttributeValue(
  attributes: Record<string, unknown> | null | undefined,
  paths: readonly string[],
): string {
  if (!attributes) return "";
  for (const path of paths) {
    const value = getAttributePath(attributes, path);
    if (value.trim()) return value;
  }
  return "";
}

export function getMissingAttributeFields(input: {
  category: string;
  attributes: Record<string, unknown>;
}): string[] {
  const cat = normalizeCategoryForHealth(input.category);
  const reqs = CATEGORY_REQUIRED_ATTRIBUTES[cat];
  if (!reqs) return [];

  return reqs
    .filter(({ paths }) => {
      const value = resolveAttributeValue(input.attributes, paths);
      return !isAttributeValueComplete(value);
    })
    .map(({ key }) => key);
}

export function getMissingFinishedGoodFields(input: {
  catalog: {
    length: string | null;
    depth: string | null;
    height: string | null;
    armHeight: string | null;
    sitHeight: string | null;
    weight: string | null;
    naFields: string[];
  } | null;
  suggestedNa?: readonly string[];
}): FinishedGoodHealthField[] {
  if (!input.catalog) {
    return [...FINISHED_GOOD_REQUIRED_CATALOG_FIELDS];
  }
  const na = new Set([
    ...input.catalog.naFields,
    ...(input.suggestedNa ?? []),
  ]);
  return FINISHED_GOOD_REQUIRED_CATALOG_FIELDS.filter((key) => {
    const naKey = FG_CATALOG_NA_KEY[key];
    if (na.has(naKey)) return false;
    const raw = FG_CATALOG_FIELD_READ[key](input.catalog!);
    const str = raw?.trim() ?? "";
    return !isAttributeValueComplete(str);
  });
}

export type RowHealthResult = {
  missingAttributeFields: string[];
  hasMissingData: boolean;
};

export function calculateRowHealth(input: {
  category: string;
  itemType: string;
  attributes: Record<string, unknown>;
  catalog: {
    length: string | null;
    depth: string | null;
    height: string | null;
    armHeight: string | null;
    sitHeight: string | null;
    weight: string | null;
    naFields: string[];
  } | null;
  suggestedNa?: readonly string[];
}): RowHealthResult {
  const cat = normalizeCategoryForHealth(input.category);
  const missingAttributeFields =
    cat === "finished good" || input.itemType === "finished_good"
      ? []
      : getMissingAttributeFields({
          category: input.category,
          attributes: input.attributes,
        });

  const missingCatalogFields =
    cat === "finished good" || input.itemType === "finished_good"
      ? getMissingFinishedGoodFields({
          catalog: input.catalog,
          suggestedNa: input.suggestedNa,
        })
      : [];

  return {
    missingAttributeFields,
    hasMissingData:
      missingAttributeFields.length > 0 || missingCatalogFields.length > 0,
  };
}
