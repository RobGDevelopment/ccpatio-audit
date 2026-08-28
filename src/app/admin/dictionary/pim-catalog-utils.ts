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
 * Used to pre-seed na_fields so bar tables etc. don't show false Missing alerts.
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
  | "msrp"
  | "length"
  | "depth"
  | "height"
  | "arm_height"
  | "sit_height";

const CATALOG_HEALTH_CHECKS: Array<{
  key: CatalogHealthField;
  read: (c: {
    msrp: string | null;
    length: string | null;
    depth: string | null;
    height: string | null;
    armHeight: string | null;
    sitHeight: string | null;
  }) => string | null | undefined;
}> = [
  { key: "msrp", read: (c) => c.msrp },
  { key: "length", read: (c) => c.length },
  { key: "depth", read: (c) => c.depth },
  { key: "height", read: (c) => c.height },
  { key: "arm_height", read: (c) => c.armHeight },
  { key: "sit_height", read: (c) => c.sitHeight },
];

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
  const cat = input.category.trim().toLowerCase();
  if (cat !== "finished good" && input.itemType !== "finished_good") {
    return [];
  }
  if (!input.catalog) {
    return CATALOG_HEALTH_CHECKS.map(({ key }) => key);
  }
  const c = input.catalog;
  const suggested = inferSuggestedNaFields({
    originalName: input.originalName,
    description: c.description,
    globalSku: input.globalSku,
  });
  const na = new Set([...c.naFields, ...suggested]);
  return CATALOG_HEALTH_CHECKS.filter(
    ({ key, read }) => !read(c)?.trim() && !na.has(key),
  ).map(({ key }) => key);
}
