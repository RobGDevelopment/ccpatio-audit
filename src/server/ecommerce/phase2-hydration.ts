/**
 * Pure COALESCE merge helpers for Phase 2 catalog hydration.
 * Existing non-null / positive Hub values always win over CSV blanks.
 */

export type BomReadiness = "ready" | "needs_variant_heal" | "no_bom_yet";

export type FieldBadges = {
  price: boolean;
  dims: boolean;
  weight: boolean;
  options: boolean;
  bom: BomReadiness;
};

export type CoalesceStringInput = {
  existing: string | null | undefined;
  incoming: string | null | undefined;
};

/** Keep existing non-blank text; fill only when blank/null. */
export function coalesceText(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const cur = normalizeBlank(existing);
  if (cur != null) return cur;
  return normalizeBlank(incoming);
}

/** Keep existing positive numeric strings; never overwrite with blank/zero/negative. */
export function coalescePositiveNumeric(
  existing: string | number | null | undefined,
  incoming: string | number | null | undefined,
): string | null {
  const cur = toPositiveString(existing);
  if (cur != null) return cur;
  return toPositiveString(incoming);
}

export function normalizeBlank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^n\/?a$/i.test(text)) return null;
  return text;
}

export function toPositiveString(
  value: string | number | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/[$,\s]/g, "").replace(/''/g, "").replace(/"/g, "");
  if (!raw || /^n\/?a$/i.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number.isInteger(n) ? String(n) : String(n);
}

export function parseMoney(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/[$,\s]/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

export function parseOptionCategories(raw: string | null | undefined): string[] {
  const text = normalizeBlank(raw);
  if (!text) return [];
  return text
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function deriveBomReadiness(input: {
  bomEdgeCount: number;
  parentKatanaVariantId: number | null | undefined;
  childMissingVariantCount: number;
}): BomReadiness {
  if (input.bomEdgeCount <= 0) return "no_bom_yet";
  if (
    input.parentKatanaVariantId == null ||
    input.parentKatanaVariantId <= 0 ||
    input.childMissingVariantCount > 0
  ) {
    return "needs_variant_heal";
  }
  return "ready";
}

export function bomBadgeLabel(readiness: BomReadiness, provisional = false): string {
  if (provisional) return "Provisional Shell";
  if (readiness === "ready") return "Full BOM";
  if (readiness === "needs_variant_heal") return "Healed BOM";
  return "Provisional Shell";
}

export function evaluateFieldBadges(input: {
  msrp: string | number | null | undefined;
  length: string | number | null | undefined;
  depth: string | number | null | undefined;
  height: string | number | null | undefined;
  weight: string | number | null | undefined;
  optionCategories: string[] | null | undefined;
  bomReadiness: BomReadiness;
}): FieldBadges {
  const hasDims =
    toPositiveString(input.length) != null &&
    toPositiveString(input.depth) != null &&
    toPositiveString(input.height) != null;
  return {
    price: parseMoney(input.msrp) != null,
    dims: hasDims,
    weight: toPositiveString(input.weight) != null,
    options: (input.optionCategories?.length ?? 0) > 0,
    bom: input.bomReadiness,
  };
}

export function isReadyToPromote(badges: FieldBadges): boolean {
  return badges.price && badges.dims && badges.weight;
}

/** Merge attribute bags without clobbering existing non-null keys with blanks. */
export function coalesceAttributes(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    if (typeof value === "string" && normalizeBlank(value) == null) continue;
    if (Array.isArray(value) && value.length === 0) {
      const cur = out[key];
      if (Array.isArray(cur) && cur.length > 0) continue;
    }
    const cur = out[key];
    if (cur != null && cur !== "" && !(typeof cur === "string" && normalizeBlank(cur) == null)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export type Phase2SowRow = {
  sowProductName: string;
  canonicalSku: string;
  collection: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  armHeight: string | null;
  sitHeight: string | null;
  baseWeight: string | null;
  msrp: string | null;
  allowedOptionCategories: string[];
};

export function parsePhase2SowCsv(text: string): Phase2SowRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iName = idx("SOW Product Name");
  const iSku = idx("Canonical SKU");
  const iCol = idx("Collection");
  const iL = idx("Length");
  const iD = idx("Depth");
  const iH = idx("Height");
  const iArm = idx("Arm Height");
  const iSit = idx("Sit Height");
  const iWt = idx("Base Weight");
  const iMsrp = idx("MSRP");
  const iOpts = idx("Allowed Option Categories");
  const out: Phase2SowRow[] = [];
  for (const row of rows.slice(1)) {
    const sowProductName = normalizeBlank(row[iName]) ?? "";
    const canonicalSku = (normalizeBlank(row[iSku]) ?? "").toUpperCase();
    if (!sowProductName && !canonicalSku) continue;
    out.push({
      sowProductName,
      canonicalSku,
      collection: normalizeBlank(row[iCol]),
      length: toPositiveString(row[iL]),
      depth: toPositiveString(row[iD]),
      height: toPositiveString(row[iH]),
      armHeight: normalizeBlank(row[iArm]),
      sitHeight: normalizeBlank(row[iSit]),
      baseWeight: toPositiveString(row[iWt]),
      msrp: parseMoney(row[iMsrp]),
      allowedOptionCategories: parseOptionCategories(row[iOpts]),
    });
  }
  return out;
}

export type WooExportRow = {
  id: string;
  type: string;
  sku: string;
  name: string;
  parent: string;
  published: string;
  shortDescription: string | null;
  description: string | null;
  categories: string | null;
  images: string | null;
  regularPrice: string | null;
  meta: Record<string, string>;
};

export function parseWooProductExportCsv(text: string): WooExportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  const col = (name: string) => header.findIndex((h) => h === name);
  const iId = col("ID");
  const iType = col("Type");
  const iSku = col("SKU");
  const iName = col("Name");
  const iParent = col("Parent");
  const iPub = col("Published");
  const iShort = col("Short description");
  const iDesc = col("Description");
  const iCat = col("Categories");
  const iImg = col("Images");
  const iPrice = col("Regular price");
  const out: WooExportRow[] = [];
  for (const row of rows.slice(1)) {
    const meta: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h.startsWith("Meta:") && row[i]) meta[h.slice(5).trim()] = row[i]!;
    });
    out.push({
      id: (row[iId] ?? "").trim(),
      type: (row[iType] ?? "").trim().toLowerCase(),
      sku: (row[iSku] ?? "").trim().toUpperCase(),
      name: (row[iName] ?? "").trim(),
      parent: (row[iParent] ?? "").trim(),
      published: (row[iPub] ?? "").trim(),
      shortDescription: normalizeBlank(row[iShort]),
      description: normalizeBlank(row[iDesc]),
      categories: normalizeBlank(row[iCat]),
      images: normalizeBlank(row[iImg]),
      regularPrice: parseMoney(row[iPrice]),
      meta,
    });
  }
  return out;
}

export function firstImageUrl(images: string | null | undefined): string | null {
  const text = normalizeBlank(images);
  if (!text) return null;
  const first = text.split(",")[0]?.trim();
  if (!first) return null;
  if (/^https?:\/\//i.test(first)) return first;
  return null;
}

export function matchWooRowToSku(
  wooRows: WooExportRow[],
  input: { sku: string; productName: string; length?: string | null; depth?: string | null },
): WooExportRow | null {
  const sku = input.sku.trim().toUpperCase();
  if (sku) {
    const bySku = wooRows.find((r) => r.sku === sku);
    if (bySku) return bySku;
  }
  const name = normalizeName(input.productName);
  if (name) {
    const byName = wooRows.find((r) => normalizeName(r.name) === name);
    if (byName) return byName;
  }
  const l = toPositiveString(input.length);
  const d = toPositiveString(input.depth);
  if (name && l && d) {
    const needle = `${name}|${l}x${d}`;
    return (
      wooRows.find((r) => {
        const rn = normalizeName(r.name);
        const dims = `${l}x${d}`;
        return rn === name || (rn.includes(name.slice(0, 12)) && rn.includes(dims));
      }) ?? null
    );
  }
  return null;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal RFC4180-ish CSV parser (quoted fields, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((c) => c.trim().length > 0)) rows.push(row);
  return rows;
}

export type NonNullSnapshot = {
  finished_goods_catalog: Record<string, number>;
  logistics_profiles: Record<string, number>;
  ecommerce_listings: Record<string, number>;
  product_bom: Record<string, number>;
};

export function assertNoRegression(
  before: NonNullSnapshot,
  after: NonNullSnapshot,
): string[] {
  const violations: string[] = [];
  for (const table of Object.keys(before) as (keyof NonNullSnapshot)[]) {
    const b = before[table];
    const a = after[table];
    for (const col of Object.keys(b)) {
      const prev = b[col] ?? 0;
      const next = a[col] ?? 0;
      if (next < prev) {
        violations.push(`${table}.${col}: ${prev} → ${next}`);
      }
    }
  }
  return violations;
}
