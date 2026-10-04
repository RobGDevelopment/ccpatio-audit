/**
 * Pure helpers for the Master Catalog E-Commerce roster.
 * No I/O, no DB — isolated so they can be unit-tested directly.
 */

/* ───────────────────── text normalization ───────────────────── */

/**
 * Join-key normalization for workbook Memo/Description text:
 * uppercase, normalized inch marks (“ ” ″ '' → "), collapsed whitespace,
 * and a single-spaced `X` between dimensions (34"x34" → 34" X 34").
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .toUpperCase()
    .replace(/[\u201C\u201D\u2033\u02DD]/g, '"')
    .replace(/''/g, '"')
    .replace(/\u2019\u2019/g, '"')
    .replace(/(\d|")\s*[X\u00D7]\s*(?=\d)/g, '$1 X ')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Family key: the memo with dimensions, inch marks and height suffixes
 * removed, leaving the product noun (e.g. `BRAVADA SOFA`).
 */
export function familyKey(memo: string | null | undefined): string {
  return normalizeText(memo)
    .replace(/\b\d+(?:\.\d+)?\s*(?:"|IN\b)?/g, " ") // 72", 34, 17.5
    .replace(/"/g, " ")
    .replace(/(^|\s)X(?=\s|$)/g, " ") // dimension separators
    .replace(/\b(?:BH|DH|CH|LH|SH|AH)\b/g, " ") // bar/dining/counter/lounge/sit/arm height suffix
    .replace(/(?<=[A-Z])-(?=[A-Z])/g, " ") // ONE-SIDED ≡ ONE SIDED
    .replace(/\s+/g, " ")
    .replace(/[\s,\-:/]+$/g, "")
    .trim();
}

/* ───────────────────── URL inheritance ───────────────────── */

export type UrlSource = "row" | "sibling" | "missing";

export interface LinkRow {
  /** Memo/Description (any casing; normalized internally). */
  memo: string;
  /** Drawing section header the row sits under. */
  section: string;
  /** Row's own product URL, if any. */
  url: string | null;
}

export interface UrlResolution {
  url: string | null;
  source: UrlSource;
}

/**
 * Walks rows in sheet order. A row without its own URL inherits the most
 * recent URL seen for the same (section, family key). Inheritance never
 * crosses a section or a different family key.
 *
 * Returns a map keyed by normalized memo (first occurrence wins unless a
 * later duplicate resolves to a better source).
 */
export function inheritFamilyUrls(rows: LinkRow[]): Map<string, UrlResolution> {
  const lastByFamily = new Map<string, string>();
  const out = new Map<string, UrlResolution>();
  const rank: Record<UrlSource, number> = { row: 3, sibling: 2, missing: 1 };

  for (const r of rows) {
    const memoKey = normalizeText(r.memo);
    if (!memoKey) continue;
    const famKey = `${normalizeText(r.section)}|${familyKey(r.memo)}`;
    const own = r.url?.trim() || null;

    let res: UrlResolution;
    if (own) {
      lastByFamily.set(famKey, own);
      res = { url: own, source: "row" };
    } else if (lastByFamily.has(famKey)) {
      res = { url: lastByFamily.get(famKey)!, source: "sibling" };
    } else {
      res = { url: null, source: "missing" };
    }

    const prev = out.get(memoKey);
    if (!prev || rank[res.source] > rank[prev.source]) out.set(memoKey, res);
  }
  return out;
}

/* ───────────────────── shared legacy SKUs ───────────────────── */

/**
 * Keyed by PRODUCT NAME (listing identity): a hub SKU can back several
 * listings, so a SKU-keyed map would keep only the last sibling.
 * True when another listing shares this listing's legacy base SKU.
 * Null/blank legacy SKUs are never shared.
 */
export function flagSharedLegacy(
  items: { productName: string; legacyBaseSku: string | null }[],
): Map<string, boolean> {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = i.legacyBaseSku?.trim().toUpperCase();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = new Map<string, boolean>();
  for (const i of items) {
    const k = i.legacyBaseSku?.trim().toUpperCase();
    out.set(i.productName, k ? (counts.get(k) ?? 0) > 1 : false);
  }
  return out;
}

/**
 * Keyed by product name. True when another listing uses the same canonical
 * hub SKU (e.g. the four FIN-TJM-MIS products).
 */
export function flagSharedCanonical(
  items: { productName: string; globalSku: string }[],
): Map<string, boolean> {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = i.globalSku.trim().toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = new Map<string, boolean>();
  for (const i of items) {
    out.set(i.productName, (counts.get(i.globalSku.trim().toUpperCase()) ?? 0) > 1);
  }
  return out;
}

/**
 * Legacy-SKU shared flags that differ from the stored ones, as `{ id,
 * legacySkuShared }` patches. Includes rows that LOST the chip (the previous
 * twin of a changed SKU), so one write never leaves a stale chip.
 */
export function sharedLegacyPatches(
  items: {
    id: string;
    productName: string;
    legacyBaseSku: string | null;
    legacySkuShared: boolean;
  }[],
): { id: string; legacySkuShared: boolean }[] {
  const next = flagSharedLegacy(items);
  const out: { id: string; legacySkuShared: boolean }[] = [];
  for (const i of items) {
    const want = next.get(i.productName) ?? false;
    if (want !== i.legacySkuShared) out.push({ id: i.id, legacySkuShared: want });
  }
  return out;
}

/** Same as sharedLegacyPatches, for the canonical hub SKU flag. */
export function sharedCanonicalPatches(
  items: {
    id: string;
    productName: string;
    globalSku: string;
    canonicalSkuShared: boolean;
  }[],
): { id: string; canonicalSkuShared: boolean }[] {
  const next = flagSharedCanonical(items);
  const out: { id: string; canonicalSkuShared: boolean }[] = [];
  for (const i of items) {
    const want = next.get(i.productName) ?? false;
    if (want !== i.canonicalSkuShared) {
      out.push({ id: i.id, canonicalSkuShared: want });
    }
  }
  return out;
}

/* ───────────────────── inline-edit normalizers ───────────────────── */

export type Normalized = { ok: true; value: string } | { ok: false; error: string };

const MAX_URL_LENGTH = 2000;

/** Product link: trim, http(s) only, parseable, <= 2000 chars. No scheme is invented. */
export function normalizeProductUrl(raw: string | null | undefined): Normalized {
  const v = (raw ?? "").trim();
  if (!v) return { ok: false, error: "Enter a link." };
  if (v.length > MAX_URL_LENGTH) {
    return { ok: false, error: `Link is too long (max ${MAX_URL_LENGTH} characters).` };
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return { ok: false, error: "Enter a full link starting with http:// or https://." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Link must start with http:// or https://." };
  }
  return { ok: true, value: v };
}

const HUB_SKU_PREFIXES = ["FIN-", "ASM-", "SA-", "RM-", "CUT-"] as const;

/**
 * Legacy base SKU: trim, uppercase, A-Z 0-9 and hyphen, 2-40 chars. Hub SKU
 * prefixes are rejected so a canonical SKU is never pasted into the legacy column.
 */
export function normalizeLegacySku(raw: string | null | undefined): Normalized {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return { ok: false, error: "Enter a legacy SKU." };
  if (v.length < 2 || v.length > 40) {
    return { ok: false, error: "Legacy SKU must be 2 to 40 characters." };
  }
  if (!/^[A-Z0-9-]+$/.test(v)) {
    return { ok: false, error: "Legacy SKU may only use letters, numbers and hyphens." };
  }
  const prefix = HUB_SKU_PREFIXES.find((p) => v.startsWith(p));
  if (prefix) {
    return {
      ok: false,
      error: `That looks like a hub SKU (${prefix}…). Enter the legacy base SKU instead.`,
    };
  }
  return { ok: true, value: v };
}


/* ───────────────────── collection derivation ───────────────────── */

/** Product lines recognised at the start of a memo (longest first). */
const MEMO_LINES = [
  "STAR LEG",
  "BRAVADA",
  "BROOKLYN",
  "WATERFALL",
  "KINGSTON",
  "CANTILEVER",
  "TENJAM",
  "OCEAN",
  "MILAN",
  "DAISY",
  "TAYLOR",
  "FLY",
] as const;

const SKU_PREFIX_LINES: Record<string, string> = {
  BRV: "Bravada",
  BRK: "Brooklyn",
  OCN: "Ocean",
  MLN: "Milan",
  WFT: "Waterfall",
  DAI: "Daisy",
  TAY: "Taylor",
  TJM: "Tenjam",
  KIN: "Kingston",
  CAN: "Cantilever",
  FLY: "Fly",
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Collection = leading product line in the memo; falls back to the SKU
 * prefix (FIN-XXX-…), then "Miscellaneous". The workbook's Collections cell
 * is intentionally ignored (blank on 61 of 110 roster rows).
 */
export function deriveCollection(
  memo: string | null | undefined,
  globalSku: string,
): string {
  const m = normalizeText(memo);
  for (const line of MEMO_LINES) {
    if (m === line || m.startsWith(`${line} `)) return titleCase(line);
  }
  const prefix = globalSku.split("-")[1]?.toUpperCase() ?? "";
  return SKU_PREFIX_LINES[prefix] ?? "Miscellaneous";
}

/* ───────────────────── money ───────────────────── */

/** "$7,400" | 7400 → "7400.00"; null for blanks / N/A / non-numeric. */
export function parseMoney(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned).toFixed(2);
}
