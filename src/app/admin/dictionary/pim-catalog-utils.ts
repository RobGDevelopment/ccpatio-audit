import {
  calculateRowHealth as calculateRowHealthCore,
  CATEGORY_REQUIRED_ATTRIBUTES,
  getMissingAttributeFields,
  getMissingFinishedGoodFields,
  isAttributeValueComplete,
  normalizeCategoryForHealth,
  resolveAttributeValue,
  type RowHealthResult,
} from "@/server/pim/attributes/health";

/** True when user input means "not applicable" for a catalog dimension. */
export function isNaToken(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  return t === "n/a" || t === "na" || t === "n.a." || t === "n.a";
}

export type CatalogNaField =
  | "msrp"
  | "length"
  | "depth"
  | "height"
  | "arm_height"
  | "sit_height"
  | "weight"
  | "image";

/**
 * Infer catalog fields that are typically N/A from factory name / description / SKU.
 */
export function inferSuggestedNaFields(input: {
  originalName: string;
  description?: string | null;
  globalSku?: string;
}): CatalogNaField[] {
  const blob = [
    input.originalName,
    input.description ?? "",
    input.globalSku ?? "",
  ]
    .join(" ")
    .toUpperCase();

  const out = new Set<CatalogNaField>();

  const isTable =
    /\bBAR\s*TABLE\b/.test(blob) ||
    /\bCOFF(?:EE)?\s*TABLE\b/.test(blob) ||
    /\bDINING\s*TABLE\b/.test(blob) ||
    /\bCOUNTER\s*TABLE\b/.test(blob) ||
    /\bCONSOLE\s*TABLE\b/.test(blob) ||
    /\bSIDE\s*TABLE\b/.test(blob) ||
    /\bEND\s*TABLE\b/.test(blob) ||
    /\bNESTING\s*TABLE\b/.test(blob) ||
    /\bTABLE\s*\(BAR\b/.test(blob) ||
    /\bTAB[-\s]/.test(blob) ||
    /-(?:BAR|COF|DIN|CNT|CON)-TAB-/i.test(blob) ||
    /-TAB-\d/.test(blob);

  const isSeating =
    /\bCHAIR\b/.test(blob) ||
    /\bSOFA\b/.test(blob) ||
    /\bLOVESEAT\b/.test(blob) ||
    /\bLOV\b/.test(blob) ||
    /\bSWIVEL\b/.test(blob) ||
    /\bSWV\b/.test(blob) ||
    /\bCLUB\b/.test(blob) ||
    /\bCHA\b/.test(blob) ||
    /\bCHAISE\b/.test(blob) ||
    /\bSECTIONAL\b/.test(blob) ||
    /\bSWING\b/.test(blob);

  const isOttomanOrBench =
    /\bOTTOMAN\b/.test(blob) ||
    /\bBENCH\b/.test(blob) ||
    /\bPOUF\b/.test(blob);

  if (isTable && !isSeating) {
    out.add("arm_height");
    out.add("sit_height");
  }

  if (isOttomanOrBench && !isSeating) {
    out.add("arm_height");
  }

  return [...out];
}

export function mergeNaFields(
  persisted: string[] | undefined,
  suggested: CatalogNaField[],
): string[] {
  return Array.from(new Set([...(persisted ?? []), ...suggested])).sort();
}

export type CatalogHealthField =
  | "length"
  | "width"
  | "height"
  | "seat_height"
  | "arm_height"
  | "weight"
  | "msrp";

export {
  getMissingAttributeFields,
  isAttributeValueComplete,
  normalizeCategoryForHealth,
  resolveAttributeValue,
  type RowHealthResult,
};

const HEALTH_TO_NA: Record<CatalogHealthField, string> = {
  length: "length",
  width: "depth",
  height: "height",
  seat_height: "sit_height",
  arm_height: "arm_height",
  weight: "weight",
  msrp: "msrp",
};

export function catalogFieldToken(healthKey: CatalogHealthField): string {
  return HEALTH_TO_NA[healthKey];
}

export function getMissingCatalogFields(input: {
  category: string;
  itemType: string;
  originalName: string;
  globalSku?: string;
  catalog: {
    msrp: string | null;
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
  } | null;
}): CatalogHealthField[] {
  const cat = normalizeCategoryForHealth(input.category);
  if (cat !== "finished good" && input.itemType !== "finished_good") {
    return [];
  }

  const suggested = inferSuggestedNaFields({
    originalName: input.originalName,
    description: input.catalog?.description,
    globalSku: input.globalSku,
  });

  const fgMissing = getMissingFinishedGoodFields({
    catalog: input.catalog,
    suggestedNa: suggested,
  });

  const out = new Set<CatalogHealthField>(fgMissing);

  if (input.catalog) {
    const msrp = input.catalog.msrp?.trim() ?? "";
    const na = new Set([...input.catalog.naFields, ...suggested]);
    if (!isAttributeValueComplete(msrp) && !na.has("msrp")) {
      out.add("msrp");
    }
  } else {
    out.add("msrp");
  }

  return [...out];
}

export function calculateRowHealth(input: {
  category: string;
  itemType: string;
  originalName: string;
  globalSku?: string;
  attributes: Record<string, unknown>;
  catalog: {
    msrp: string | null;
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
  } | null;
}): RowHealthResult & { missingCatalogFields: CatalogHealthField[] } {
  const suggested = inferSuggestedNaFields({
    originalName: input.originalName,
    description: input.catalog?.description,
    globalSku: input.globalSku,
  });
  const core = calculateRowHealthCore({
    category: input.category,
    itemType: input.itemType,
    attributes: input.attributes,
    catalog: input.catalog,
    suggestedNa: suggested,
  });
  const missingCatalogFields = getMissingCatalogFields(input);
  return {
    missingAttributeFields: core.missingAttributeFields,
    missingCatalogFields,
    hasMissingData:
      core.missingAttributeFields.length > 0 ||
      missingCatalogFields.length > 0,
  };
}

export type MissingFieldDescriptor = {
  key: string;
  label: string;
  target: "catalog" | "attribute" | "mapping";
  patchField: string;
  allowNa: boolean;
};

export type ProductFieldDescriptor = MissingFieldDescriptor & {
  section: "core" | "catalog" | "attribute";
  initialValue: string;
  isMissing: boolean;
};

const CATALOG_FIELD_LABELS: Record<CatalogHealthField, string> = {
  length: "Length",
  width: "Width",
  height: "Height",
  seat_height: "Seat height",
  arm_height: "Arm height",
  weight: "Weight",
  msrp: "MSRP",
};

const ATTRIBUTE_FIELD_LABELS: Record<string, string> = {
  slab_length: "Slab L",
  slab_width: "Slab W",
  thickness_mm: "Thick mm",
  finish: "Finish",
  yield_sqft: "Yield sqft",
  grade: "Grade",
  roll_width: "Roll W",
  pattern_repeat: "Pattern repeat",
  rub_count: "Rub count",
  colorway: "Colorway",
  profile_type: "Profile",
  dimensions: "Dimensions",
  wall_thickness: "Wall thick",
  alloy: "Alloy",
  stock_length: "Stock L",
  finish_type: "Finish type",
  cure_temp: "Cure °F",
  cure_time: "Cure min",
  ral_code: "RAL",
};

/** Resolve missing fields into modal-ready patch descriptors. */
export function buildMissingFieldDescriptors(input: {
  category: string;
  itemType: string;
  originalName: string;
  globalSku?: string;
  attributes: Record<string, unknown>;
  catalog: {
    msrp: string | null;
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
  } | null;
}): MissingFieldDescriptor[] {
  const health = calculateRowHealth(input);
  const descriptors: MissingFieldDescriptor[] = [];

  for (const key of health.missingCatalogFields) {
    descriptors.push({
      key,
      label: CATALOG_FIELD_LABELS[key],
      target: "catalog",
      patchField: catalogFieldToken(key),
      allowNa: true,
    });
  }

  const cat = normalizeCategoryForHealth(input.category);
  const reqs = CATEGORY_REQUIRED_ATTRIBUTES[cat] ?? [];
  for (const attrKey of health.missingAttributeFields) {
    const req = reqs.find((row) => row.key === attrKey);
    descriptors.push({
      key: attrKey,
      label: ATTRIBUTE_FIELD_LABELS[attrKey] ?? attrKey,
      target: "attribute",
      patchField: req?.paths[0] ?? attrKey,
      allowNa: true,
    });
  }

  return descriptors;
}

type ProductFieldInput = {
  category: string;
  itemType: string;
  originalName: string;
  globalSku?: string;
  uomPurchase?: string | null;
  uomConsume?: string | null;
  baseCost?: string | null;
  attributes: Record<string, unknown>;
  catalog: {
    msrp: string | null;
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
  } | null;
};

function isFgRow(input: ProductFieldInput): boolean {
  const cat = normalizeCategoryForHealth(input.category);
  return cat === "finished good" || input.itemType === "finished_good";
}

/** Full fieldset for product detail modal (core + catalog + attributes). */
export function buildAllProductFieldDescriptors(
  input: ProductFieldInput,
): ProductFieldDescriptor[] {
  const health = calculateRowHealth(input);
  const missingCatalog = new Set(health.missingCatalogFields);
  const missingAttrs = new Set(health.missingAttributeFields);
  const descriptors: ProductFieldDescriptor[] = [];
  const fg = isFgRow(input);
  const na = new Set(input.catalog?.naFields ?? []);

  descriptors.push({
    key: "original_name",
    label: "Factory name",
    target: "mapping",
    patchField: "original_name",
    allowNa: false,
    section: "core",
    initialValue: input.originalName ?? "",
    isMissing: !input.originalName?.trim(),
  });

  descriptors.push({
    key: "uom_purchase",
    label: "UOM (buy)",
    target: "mapping",
    patchField: "uom_purchase",
    allowNa: false,
    section: "core",
    initialValue: input.uomPurchase ?? "",
    isMissing: !input.uomPurchase?.trim(),
  });

  descriptors.push({
    key: "uom_consume",
    label: "UOM (use)",
    target: "mapping",
    patchField: "uom_consume",
    allowNa: false,
    section: "core",
    initialValue: input.uomConsume ?? "",
    isMissing: !input.uomConsume?.trim(),
  });

  if (fg) {
    descriptors.push({
      key: "msrp",
      label: "MSRP",
      target: "catalog",
      patchField: "msrp",
      allowNa: true,
      section: "core",
      initialValue: na.has("msrp")
        ? "N/A"
        : (input.catalog?.msrp?.trim() ?? ""),
      isMissing: missingCatalog.has("msrp"),
    });
  } else {
    descriptors.push({
      key: "base_cost",
      label: "Base cost",
      target: "mapping",
      patchField: "base_cost",
      allowNa: false,
      section: "core",
      initialValue: input.baseCost?.trim() ?? "",
      isMissing: !input.baseCost?.trim(),
    });
  }

  if (fg) {
    const catalogFields: { key: CatalogHealthField; patch: string; label: string }[] =
      [
        { key: "length", patch: "length", label: "Length" },
        { key: "width", patch: "depth", label: "Width" },
        { key: "height", patch: "height", label: "Height" },
        { key: "seat_height", patch: "sit_height", label: "Seat height" },
        { key: "arm_height", patch: "arm_height", label: "Arm height" },
        { key: "weight", patch: "weight", label: "Weight" },
      ];
    for (const { key, patch, label } of catalogFields) {
      const naKey = catalogFieldToken(key);
      const raw =
        key === "length"
          ? input.catalog?.length
          : key === "width"
            ? input.catalog?.depth
            : key === "height"
              ? input.catalog?.height
              : key === "seat_height"
                ? input.catalog?.sitHeight
                : key === "arm_height"
                  ? input.catalog?.armHeight
                  : input.catalog?.weight;
      descriptors.push({
        key,
        label,
        target: "catalog",
        patchField: patch,
        allowNa: true,
        section: (key === "length" || key === "width") ? "core" : "catalog",
        initialValue: na.has(naKey) ? "N/A" : (raw?.trim() ?? ""),
        isMissing: missingCatalog.has(key),
      });
    }
  }

  const cat = normalizeCategoryForHealth(input.category);
  const reqs = CATEGORY_REQUIRED_ATTRIBUTES[cat] ?? [];
  for (const req of reqs) {
    const value = resolveAttributeValue(input.attributes, req.paths);
    descriptors.push({
      key: req.key,
      label: ATTRIBUTE_FIELD_LABELS[req.key] ?? req.key,
      target: "attribute",
      patchField: req.paths[0]!,
      allowNa: true,
      section: "attribute",
      initialValue: value,
      isMissing: missingAttrs.has(req.key),
    });
  }

  return descriptors;
}

/** Attribute + core field descriptors for raw-material creation (all required = missing). */
export function buildRawMaterialCreationFields(category: string): ProductFieldDescriptor[] {
  return buildAllProductFieldDescriptors({
    category,
    itemType: "raw_material",
    originalName: "",
    globalSku: "",
    uomPurchase: "",
    uomConsume: "",
    baseCost: "",
    attributes: {},
    catalog: null,
  }).filter((field) => field.section === "attribute");
}

export type BatchCompletionStats = {
  label: string;
  total: number;
  complete: number;
  percent: number;
};

type HealthRowInput = {
  category: string;
  itemType: string;
  originalName: string;
  globalSku?: string;
  attributes: Record<string, unknown>;
  catalog: {
    msrp: string | null;
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
  } | null;
};

/** Completion % for visible rows (category progress bar). */
export function computeBatchCompletion(
  rows: HealthRowInput[],
  label: string,
): BatchCompletionStats {
  const total = rows.length;
  if (total === 0) {
    return { label, total: 0, complete: 0, percent: 100 };
  }
  const complete = rows.filter(
    (row) =>
      !calculateRowHealth({
        category: row.category,
        itemType: row.itemType,
        originalName: row.originalName,
        globalSku: row.globalSku,
        attributes: row.attributes,
        catalog: row.catalog,
      }).hasMissingData,
  ).length;
  return {
    label,
    total,
    complete,
    percent: Math.round((complete / total) * 100),
  };
}
