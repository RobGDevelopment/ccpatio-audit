/**
 * VividWorks Phase 1 + Phase 2 handoff datapack.
 *
 * Parses docs/Vividworks/sow_master_list.txt, reconciles each SOW line against
 * Website Products (Excel row 6 headers), mints FIN-* SKUs via sku-engine,
 * pulls live FAB-/PWD-/STN- finishes from Postgres, and writes a relational
 * pack (no cartesian explosion) to docs/Vividworks/Handoff/.
 *
 * Usage:
 *   npx tsx scripts/vividworks/04-generate-complete-sow-datapack.ts
 *
 * Env: POSTGRES_URL (same as the rest of the hub)
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, like, or } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { generateFinishedGoodSku } from "../../src/lib/sku-engine";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  raw_materials_catalog,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const SOW_PATH = path.resolve(process.cwd(), "docs/Vividworks/sow_master_list.txt");
const XLSX_PATH = path.resolve(
  process.cwd(),
  "docs/Vividworks/VividWorksStartingProducts.xlsx",
);
const OUT_DIR = path.resolve(process.cwd(), "docs/Vividworks/Handoff");
const SHEET_NAME = "Website Products";
const HEADER_ROW_INDEX = 5;

type Phase = 1 | 2;

type OptionFlags = {
  fabric: boolean;
  powder: boolean;
  dekton: boolean;
  pillow: boolean;
  addOns: boolean;
};

type ExcelProduct = {
  excelRow: number;
  collection: string;
  memo: string;
  productName: string;
  length: string;
  depth: string;
  height: string;
  armHeight: string;
  sitHeight: string;
  weight: string;
  msrp: string;
  msrpAluminum: string;
  flags: OptionFlags;
  ecommerce: boolean;
};

type SowItem = {
  phase: Phase;
  sowLine: number;
  sowName: string;
};

type MatchedProduct = SowItem & {
  match: "exact" | "fuzzy" | "unmatched";
  excel: ExcelProduct | null;
  canonicalSku: string;
  confidence: number;
  closest: Array<{ memo: string; excelRow: number; score: number }>;
  length: string;
  depth: string;
  height: string;
};

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "";
  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function headerIndex(headers: unknown[], ...aliases: string[]): number {
  const wanted = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => wanted.has(normalizeHeader(header)));
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function qboDisplayName(raw: string): string {
  const trimmed = raw.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && colon < trimmed.length - 1) {
    return trimmed.slice(colon + 1).trim();
  }
  return trimmed;
}

/** Match key: lowercase, quotes/inches stripped, hyphens → space, collapsed ws. */
function normalizeMatchKey(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/''+/g, '"')
    .replace(/["'″′]/g, "")
    .replace(/×/g, "x")
    .replace(/\bw\//g, "with ")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(prev + cost, dp[j]! + 1, dp[j - 1]! + 1);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function isTruthyFlag(value: unknown): boolean {
  const t = cellText(value).toLowerCase();
  return t === "y" || t === "yes" || t === "true" || t === "1" || t === "x";
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

type NamedDims = { length: string; depth: string; height: string };

/** Pull L/D/H from factory names like `72" x 34" x 31" BH` or `84" DIAMETER`. */
function parseNamedDimensions(name: string): NamedDims {
  const empty: NamedDims = { length: "", depth: "", height: "" };
  if (!name) return empty;

  const diameter = name.match(
    /(\d{2,3})\s*["']?\s*(?:diameter|dia\.?)\b/i,
  );
  if (diameter?.[1]) {
    return { length: diameter[1], depth: diameter[1], height: "" };
  }

  const triple = name.match(
    /(\d{2,3})\s*["']?\s*[x×]\s*(\d{2,3})\s*["']?(?:\s*[x×]\s*(\d{2,3}))?/i,
  );
  if (triple?.[1] && triple[2]) {
    return {
      length: triple[1],
      depth: triple[2],
      height: triple[3] ?? "",
    };
  }

  return empty;
}

function familyKey(name: string): string {
  return normalizeMatchKey(name)
    .replace(/\b\d{1,3}(?:\s*x\s*\d{1,3}){0,2}\b/g, " ")
    .replace(/\b(bh|sh|diameter|dia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyFlag(flags: OptionFlags): boolean {
  return flags.fabric || flags.powder || flags.dekton || flags.pillow || flags.addOns;
}

function coalesceDim(
  preferred: string,
  named: string,
  column: string,
  inherited: string,
): string {
  return preferred || named || column || inherited;
}

const COLLECTION_LABELS: ReadonlyArray<[string, string]> = [
  ["WATERFALL", "Waterfall"],
  ["BRAVADA", "Bravada"],
  ["BROOKLYN", "Brooklyn"],
  ["OCEAN", "Ocean"],
  ["MILAN", "Milan"],
  ["MARINA", "Marina"],
  ["TAYLOR", "Taylor"],
  ["DAISY", "Daisy"],
  ["CABANA", "Cabana"],
  ["FLEXY", "Flexy"],
  ["TENJAM", "Tenjam"],
];

function extractCollectionLabel(name: string): string {
  const upper = name.toUpperCase();
  for (const [needle, label] of COLLECTION_LABELS) {
    if (upper.includes(needle)) return label;
  }
  return "";
}

function stripSowLine(raw: string): string {
  return raw
    .replace(/^[\s\t\u00a0]+/, "")
    .replace(/[\s\t\u00a0]+$/, "")
    .replace(/^[-*•]+\s*/, "")
    .trim();
}

function isSowProse(line: string): boolean {
  const lower = line.toLowerCase();
  if (line.length > 140) return true;
  return (
    /^(this |the |all the |phase 2 product|the current remaining|exclusions)/i.test(
      line,
    ) ||
    lower.includes("will be confirmed") ||
    lower.includes("will be selected") ||
    lower.includes("may not have visual")
  );
}

function parseSow(text: string): SowItem[] {
  const items: SowItem[] = [];
  let phase: Phase | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripSowLine(lines[i] ?? "");
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower.includes("phase 1 delivery")) {
      phase = 1;
      continue;
    }
    if (
      lower.includes("phase 2 delivery") ||
      lower.includes("sku list below")
    ) {
      phase = 2;
      continue;
    }
    if (lower.startsWith("exclusions")) break;
    if (!phase) continue;
    if (isSowProse(line)) continue;
    items.push({ phase, sowLine: i + 1, sowName: line });
  }
  return items;
}

function readExcelCatalog(): ExcelProduct[] {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`Missing spreadsheet: ${XLSX_PATH}`);
  }
  const workbook = XLSX.readFile(XLSX_PATH, { cellDates: false });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Sheet "${SHEET_NAME}" not found. Available: ${workbook.SheetNames.join(", ")}`,
    );
  }
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    sheet,
    { header: 1, defval: null, raw: false, blankrows: true },
  );

  let headerRowIndex = HEADER_ROW_INDEX;
  const exact = matrix[HEADER_ROW_INDEX] ?? [];
  if (headerIndex(exact, "memo description", "memo/description") < 0) {
    const found = matrix.findIndex(
      (row, index) =>
        index <= 12 &&
        headerIndex(row ?? [], "memo description", "memo/description") >= 0,
    );
    if (found >= 0) headerRowIndex = found;
  }

  const headers = matrix[headerRowIndex] ?? [];
  const idx = {
    ecommerce: headerIndex(headers, "e-commerce", "ecommerce"),
    collection: headerIndex(headers, "collections", "collection"),
    armHeight: headerIndex(headers, "arm height"),
    sitHeight: headerIndex(headers, "sit height"),
    length: headerIndex(headers, "length"),
    depth: headerIndex(headers, "depth"),
    height: headerIndex(headers, "height"),
    productName: headerIndex(
      headers,
      "product service full name",
      "product/service full name",
    ),
    memo: headerIndex(headers, "memo description", "memo/description"),
    msrp: headerIndex(headers, "msrp"),
    msrpAluminum: headerIndex(
      headers,
      "msrp w aluminum frame",
      "msrp with aluminum frame",
    ),
    weight: headerIndex(headers, "weight"),
    fabric: headerIndex(headers, "fabric color"),
    frame: headerIndex(headers, "frame color"),
    dekton: headerIndex(headers, "dekton color"),
    pillow: headerIndex(headers, "pillow color"),
    addOns: headerIndex(headers, "add ons", "add-ons", "addons"),
  };

  if (idx.memo < 0 && idx.productName < 0) {
    throw new Error(
      `Memo/Description not found on Excel row ${headerRowIndex + 1}. Headers: ${headers
        .filter(Boolean)
        .join(" | ")}`,
    );
  }

  console.log("[datapack] Excel headers row", headerRowIndex + 1);
  console.log("[datapack] column map", idx);

  const products: ExcelProduct[] = [];
  let lastCollection = "";
  const lastByFamily = new Map<
    string,
    { armHeight: string; sitHeight: string; weight: string; flags: OptionFlags }
  >();
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const memo = idx.memo >= 0 ? cellText(row[idx.memo]) : "";
    const productName =
      idx.productName >= 0 ? qboDisplayName(cellText(row[idx.productName])) : "";
    if (!memo && !productName) continue;

    const collectionFromRow =
      idx.collection >= 0 ? cellText(row[idx.collection]) : "";
    const namedCollection = extractCollectionLabel(memo || productName);
    if (namedCollection) lastCollection = namedCollection;
    else if (collectionFromRow) lastCollection = collectionFromRow;

    const named = parseNamedDimensions(memo || productName);
    const colLength = idx.length >= 0 ? cellText(row[idx.length]) : "";
    const colDepth = idx.depth >= 0 ? cellText(row[idx.depth]) : "";
    const colHeight = idx.height >= 0 ? cellText(row[idx.height]) : "";
    const armHeight = idx.armHeight >= 0 ? cellText(row[idx.armHeight]) : "";
    const sitHeight = idx.sitHeight >= 0 ? cellText(row[idx.sitHeight]) : "";
    const weight = idx.weight >= 0 ? cellText(row[idx.weight]) : "";
    const family = familyKey(memo || productName);
    const inherited = lastByFamily.get(family);

    const flags: OptionFlags = {
      fabric: idx.fabric >= 0 && isTruthyFlag(row[idx.fabric]),
      powder: idx.frame >= 0 && isTruthyFlag(row[idx.frame]),
      dekton: idx.dekton >= 0 && isTruthyFlag(row[idx.dekton]),
      pillow: idx.pillow >= 0 && isTruthyFlag(row[idx.pillow]),
      addOns: idx.addOns >= 0 && isTruthyFlag(row[idx.addOns]),
    };

    products.push({
      excelRow: i + 1,
      collection: namedCollection || collectionFromRow || lastCollection,
      memo,
      productName,
      length: named.length || colLength,
      depth: named.depth || colDepth,
      height: named.height || colHeight,
      armHeight: armHeight || inherited?.armHeight || "",
      sitHeight: sitHeight || inherited?.sitHeight || "",
      weight: weight || inherited?.weight || "",
      msrp: idx.msrp >= 0 ? cellText(row[idx.msrp]) : "",
      msrpAluminum:
        idx.msrpAluminum >= 0 ? cellText(row[idx.msrpAluminum]) : "",
      flags: hasAnyFlag(flags) ? flags : inherited?.flags ?? flags,
      ecommerce: idx.ecommerce >= 0 && isTruthyFlag(row[idx.ecommerce]),
    });

    const last = products[products.length - 1]!;
    lastByFamily.set(family, {
      armHeight: last.armHeight,
      sitHeight: last.sitHeight,
      weight: last.weight,
      flags: last.flags,
    });
  }
  return products;
}

function indexExcel(products: ExcelProduct[]): Map<string, ExcelProduct[]> {
  const index = new Map<string, ExcelProduct[]>();
  const add = (key: string, product: ExcelProduct) => {
    const normalized = normalizeMatchKey(key);
    if (!normalized) return;
    const list = index.get(normalized) ?? [];
    list.push(product);
    index.set(normalized, list);
  };
  for (const product of products) {
    for (const key of lookupKeys(product.memo)) add(key, product);
    for (const key of lookupKeys(product.productName)) add(key, product);
  }
  return index;
}

function pickBest(candidates: ExcelProduct[], sowName: string): ExcelProduct {
  const sowDims = parseNamedDimensions(sowName);
  const scored = [...candidates].sort((a, b) => {
    const score = (row: ExcelProduct) => {
      const named = parseNamedDimensions(row.memo || row.productName);
      const length = digitsOnly(named.length || row.length);
      const depth = digitsOnly(named.depth || row.depth);
      return (
        (sowDims.length && length === sowDims.length ? 8 : 0) +
        (sowDims.depth && depth === sowDims.depth ? 8 : 0) +
        (length && depth ? 4 : 0) +
        (row.msrp ? 2 : 0) +
        (row.ecommerce ? 1 : 0) +
        (row.collection ? 1 : 0)
      );
    };
    return score(b) - score(a);
  });
  return scored[0]!;
}

function resolveOutputDims(
  sowName: string,
  excel: ExcelProduct | null,
): NamedDims {
  const fromSow = parseNamedDimensions(sowName);
  const fromExcelName = excel
    ? parseNamedDimensions(excel.memo || excel.productName)
    : { length: "", depth: "", height: "" };
  return {
    length: coalesceDim(
      fromSow.length,
      fromExcelName.length,
      excel?.length ?? "",
      "",
    ),
    depth: coalesceDim(
      fromSow.depth,
      fromExcelName.depth,
      excel?.depth ?? "",
      "",
    ),
    height: coalesceDim(
      fromSow.height,
      fromExcelName.height,
      excel?.height ?? "",
      "",
    ),
  };
}

function lookupKeys(raw: string): string[] {
  const primary = normalizeMatchKey(raw);
  const keys = new Set<string>();
  if (primary) keys.add(primary);

  const withoutParens = normalizeMatchKey(
    raw.replace(/\s*\((?:alt|base|unspecified size|alt size)[^)]*\)\s*$/i, ""),
  );
  if (withoutParens) keys.add(withoutParens);

  const collections = COLLECTION_LABELS.map(([needle]) => needle.toLowerCase());
  for (const collection of collections) {
    if (primary.startsWith(`${collection} `)) {
      keys.add(primary.slice(collection.length).trim());
    }
  }
  return [...keys];
}

function mintSku(
  name: string,
  collection: string,
  length: string,
  depth: string,
): string {
  // sku-engine scans collection haystack before the name and lists OCEAN
  // before WATERFALL. If the title already names the family, do not append
  // a stale Excel collection that would steal the code.
  const haystack = extractCollectionLabel(name) ? name : collection;
  return generateFinishedGoodSku(name, haystack, length, depth);
}

function closestCandidates(
  needle: string,
  products: ExcelProduct[],
  limit = 5,
): Array<{ memo: string; excelRow: number; score: number }> {
  const scored = products.map((product) => {
    const memoKey = normalizeMatchKey(product.memo || product.productName);
    return {
      memo: product.memo || product.productName,
      excelRow: product.excelRow,
      score: similarity(needle, memoKey),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function reconcile(
  sowItems: SowItem[],
  products: ExcelProduct[],
): MatchedProduct[] {
  const index = indexExcel(products);
  return sowItems.map((item) => {
    let match: MatchedProduct["match"] = "unmatched";
    let excel: ExcelProduct | null = null;
    let confidence = 0;
    let closest: MatchedProduct["closest"] = [];

    for (const key of lookupKeys(item.sowName)) {
      const exact = index.get(key);
      if (exact && exact.length > 0) {
        excel = pickBest(exact, item.sowName);
        match = "exact";
        confidence = 1;
        break;
      }
    }

    if (!excel) {
      closest = closestCandidates(normalizeMatchKey(item.sowName), products);
      const best = closest[0];
      const bestProduct =
        best != null
          ? products.find((row) => row.excelRow === best.excelRow)
          : undefined;
      if (best && bestProduct && best.score >= 0.88) {
        excel = bestProduct;
        match = "fuzzy";
        confidence = best.score;
      } else {
        confidence = best?.score ?? 0;
      }
    }

    const dims = resolveOutputDims(item.sowName, excel);
    const collection =
      extractCollectionLabel(item.sowName) || excel?.collection || "";
    return {
      ...item,
      match,
      excel: excel
        ? { ...excel, collection: collection || excel.collection }
        : excel,
      canonicalSku: mintSku(item.sowName, collection, dims.length, dims.depth),
      confidence,
      closest,
      length: dims.length,
      depth: dims.depth,
      height: dims.height,
    };
  });
}

function allowedCategories(flags: OptionFlags | undefined): string {
  if (!flags) return "";
  const parts: string[] = [];
  if (flags.fabric) parts.push("Fabric");
  if (flags.powder) parts.push("Powder");
  if (flags.dekton) parts.push("Dekton");
  if (flags.pillow) parts.push("Pillow");
  if (flags.addOns) parts.push("Add-Ons");
  return parts.join("|");
}

function productCsvRow(row: MatchedProduct): string[] {
  const excel = row.excel;
  return [
    row.sowName,
    row.canonicalSku,
    excel?.collection ?? "",
    row.length,
    row.depth,
    row.height,
    excel?.armHeight ?? "",
    excel?.sitHeight ?? "",
    excel?.weight ?? "",
    excel?.msrp ?? "",
    row.match === "unmatched"
      ? "UNMATCHED"
      : allowedCategories(excel?.flags),
  ];
}

function writeCsv(filePath: string, header: string[], rows: string[][]): void {
  const lines = [
    header.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\r\n")}\r\n`, "utf8");
}

function extractAttrWeight(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return "";
  }
  const record = attributes as Record<string, unknown>;
  const preferred = [
    "weight",
    "weight_lbs",
    "weightLbs",
    "net_weight",
    "lbs",
    "weight_plf",
  ];
  for (const key of preferred) {
    const value = record[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  const stack: unknown[] = [record];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/weight/i.test(key) && value != null && typeof value !== "object") {
        const text = String(value).trim();
        if (text) return text;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return "";
}

function materialCategory(sku: string, category: string): "Fabric" | "Powder" | "Dekton" | "Other" {
  if (sku.startsWith("FAB-")) return "Fabric";
  if (sku.startsWith("PWD-")) return "Powder";
  if (sku.startsWith("STN-")) return "Dekton";
  const lower = category.toLowerCase();
  if (lower.includes("fabric")) return "Fabric";
  if (lower.includes("powder")) return "Powder";
  if (lower.includes("dekton") || lower.includes("stone")) return "Dekton";
  return "Other";
}

async function loadMaterials(): Promise<
  Array<{
    sku: string;
    category: string;
    name: string;
    cost: string;
    uom: string;
    weight: string;
  }>
> {
  if (!process.env.POSTGRES_URL?.trim()) {
    throw new Error("POSTGRES_URL is not set. Copy .env.example to .env.local.");
  }
  const db = getDb();
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      isActive: sku_mappings.is_active,
      mappingCost: sku_mappings.base_cost,
      mappingUom: sku_mappings.uom_consume,
      mappingPurchaseUom: sku_mappings.uom_purchase,
      attributes: sku_mappings.attributes,
      catalogName: raw_materials_catalog.name,
      catalogCategory: raw_materials_catalog.category,
      catalogCost: raw_materials_catalog.cost_per_unit,
      catalogUom: raw_materials_catalog.unit_of_measure,
    })
    .from(sku_mappings)
    .leftJoin(
      raw_materials_catalog,
      eq(raw_materials_catalog.sku, sku_mappings.global_sku),
    )
    .where(
      and(
        eq(sku_mappings.is_active, true),
        or(
          like(sku_mappings.global_sku, "FAB-%"),
          like(sku_mappings.global_sku, "PWD-%"),
          like(sku_mappings.global_sku, "STN-%"),
        ),
      ),
    );

  return rows
    .map((row) => {
      const sku = row.sku.trim().toUpperCase();
      return {
        sku,
        category: materialCategory(
          sku,
          row.category || row.catalogCategory || "",
        ),
        name: (row.name || row.catalogName || sku).trim(),
        cost: String(row.catalogCost ?? row.mappingCost ?? ""),
        uom: (
          row.catalogUom ||
          row.mappingUom ||
          row.mappingPurchaseUom ||
          "ea"
        ).trim(),
        weight: extractAttrWeight(row.attributes),
      };
    })
    .filter((row) => row.category !== "Other")
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function slotMap(flags: OptionFlags | undefined) {
  return {
    upholstery: {
      enabled: Boolean(flags?.fabric),
      prefix: "FAB-*",
      excelFlag: "Fabric Color",
    },
    frameFinish: {
      enabled: Boolean(flags?.powder),
      prefix: "PWD-*",
      excelFlag: "Frame Color",
    },
    tableTop: {
      enabled: Boolean(flags?.dekton),
      prefix: "STN-*",
      excelFlag: "Dekton Color",
    },
    pillow: {
      enabled: Boolean(flags?.pillow),
      prefix: "FAB-*",
      excelFlag: "Pillow Color",
    },
    addOns: {
      enabled: Boolean(flags?.addOns),
      prefix: null,
      excelFlag: "Add-Ons",
    },
  };
}

async function main(): Promise<void> {
  if (!fs.existsSync(SOW_PATH)) {
    throw new Error(`Missing SOW list: ${SOW_PATH}`);
  }

  const sowItems = parseSow(fs.readFileSync(SOW_PATH, "utf8"));
  const excel = readExcelCatalog();
  const matched = reconcile(sowItems, excel);

  const phase1 = matched.filter((row) => row.phase === 1);
  const phase2 = matched.filter((row) => row.phase === 2);
  const unmatched = matched.filter((row) => row.match === "unmatched");
  const fuzzy = matched.filter((row) => row.match === "fuzzy");

  console.log("[datapack] SOW parsed", {
    phase1: phase1.length,
    phase2: phase2.length,
    excelRows: excel.length,
    exact: matched.filter((row) => row.match === "exact").length,
    fuzzy: fuzzy.length,
    unmatched: unmatched.length,
  });

  const materials = await loadMaterials();
  console.log("[datapack] materials", {
    fabric: materials.filter((row) => row.category === "Fabric").length,
    powder: materials.filter((row) => row.category === "Powder").length,
    dekton: materials.filter((row) => row.category === "Dekton").length,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const productHeader = [
    "SOW Product Name",
    "Canonical SKU",
    "Collection",
    "Length",
    "Depth",
    "Height",
    "Arm Height",
    "Sit Height",
    "Base Weight",
    "MSRP",
    "Allowed Option Categories",
  ];

  const phase1Path = path.join(OUT_DIR, "vividworks_phase1_products.csv");
  const phase2Path = path.join(OUT_DIR, "vividworks_phase2_products.csv");
  const materialsPath = path.join(OUT_DIR, "vividworks_material_options.csv");
  const rulesPath = path.join(OUT_DIR, "vividworks_configuration_rules.json");
  const auditPath = path.join(OUT_DIR, "sow_unmatched_audit.json");

  writeCsv(phase1Path, productHeader, phase1.map(productCsvRow));
  writeCsv(phase2Path, productHeader, phase2.map(productCsvRow));
  writeCsv(
    materialsPath,
    [
      "Material SKU",
      "Category (Fabric/Powder/Dekton)",
      "Material Name",
      "Cost Per Unit",
      "UOM",
      "Weight",
    ],
    materials.map((row) => [
      row.sku,
      row.category,
      row.name,
      row.cost,
      row.uom,
      row.weight,
    ]),
  );

  const rules = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: "Relational pack. Do not cartesian-expand Base × FAB × PWD × STN.",
    slotCatalog: {
      upholstery: { prefix: "FAB-*", excelFlag: "Fabric Color" },
      frameFinish: { prefix: "PWD-*", excelFlag: "Frame Color" },
      tableTop: { prefix: "STN-*", excelFlag: "Dekton Color" },
      pillow: { prefix: "FAB-*", excelFlag: "Pillow Color" },
      addOns: { prefix: null, excelFlag: "Add-Ons" },
    },
    products: matched.map((row) => ({
      phase: row.phase,
      sowName: row.sowName,
      canonicalSku: row.canonicalSku,
      collection: row.excel?.collection ?? "",
      match: row.match,
      msrp: row.excel?.msrp ?? "",
      msrpAluminum: row.excel?.msrpAluminum ?? "",
      slots: slotMap(row.excel?.flags),
    })),
  };
  fs.writeFileSync(rulesPath, `${JSON.stringify(rules, null, 2)}\n`, "utf8");

  const audit = {
    generatedAt: new Date().toISOString(),
    unmatchedCount: unmatched.length,
    fuzzyMatchedCount: fuzzy.length,
    unmatched: unmatched.map((row) => ({
      phase: row.phase,
      sowLine: row.sowLine,
      sowName: row.sowName,
      generatedSkuWithoutExcel: row.canonicalSku,
      closestCandidates: row.closest,
    })),
    fuzzyMatched: fuzzy.map((row) => ({
      phase: row.phase,
      sowLine: row.sowLine,
      sowName: row.sowName,
      excelRow: row.excel?.excelRow,
      excelMemo: row.excel?.memo,
      confidence: row.confidence,
      canonicalSku: row.canonicalSku,
    })),
  };
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log("[datapack] wrote", {
    phase1Path,
    phase2Path,
    materialsPath,
    rulesPath,
    auditPath,
  });
}

main()
  .catch((error: unknown) => {
    console.error("[datapack] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
