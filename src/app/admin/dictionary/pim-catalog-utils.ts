import {
  calculateRowHealth as calculateRowHealthCore,
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
