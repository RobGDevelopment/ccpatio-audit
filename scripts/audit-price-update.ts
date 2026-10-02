/**
 * Read-only October 2026 price-sheet → Spark Tab 01 name mapper.
 *
 * Produces a human-review CSV (price_audit_map.csv). Does NOT modify any .xlsx.
 *
 * Usage:
 *   npm run ecom:price-audit
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SPARK_HANDOFF_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx",
);

export const PRICING_UPDATE_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/PRICING UPDATE - - CC PATIO CURRENT PRICE List 2026 MSRP.xlsx",
);

export const PRICE_AUDIT_CSV = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/price_audit_map.csv",
);

const TAB01 = "01 - PHASE 1 & 2 PRODUCTS";
const PRICE_SHEET = "Original Price Sheet";

/** Price sheet header is Excel row 6 (1-based). */
export const PRICE_SHEET_HEADER_ROW = 6;

export type SparkProductRow = {
  masterSku: string;
  productName: string;
  webBasePrice: string;
};

export type PriceSheetRow = {
  memoDescription: string;
  msrpOld: string;
  pricingIncrease100126: string;
};

export type PriceAuditMapRow = {
  masterSku: string;
  sparkProductName: string;
  sparkCurrentPrice: string;
  foundPriceSheetName: string;
  matchConfidencePct: number;
  newProposedPrice1001: string;
  approved: string;
};

export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const f = value as ExcelJS.CellFormulaValue;
      if (f.result != null && f.result !== "") return String(f.result).trim();
      return "";
    }
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("").trim();
    }
    if ("text" in value) return String((value as { text?: string }).text ?? "").trim();
  }
  return String(value).trim();
}

/** Exact-match key: trim + case-fold. */
export function normalizeExactKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Fuzzy-match key: collapse punctuation/hyphen variants that commonly cause orphans
 * (e.g. ONE-SIDED vs ONE SIDED) without inventing new tokens.
 */
export function normalizeFuzzyKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Similarity 0–100 from Levenshtein ratio. */
export function similarityPercent(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.round((1 - dist / maxLen) * 100);
}

export function findBestPriceMatch(
  sparkName: string,
  priceRows: PriceSheetRow[],
): { row: PriceSheetRow | null; confidencePct: number; exact: boolean } {
  const exactKey = normalizeExactKey(sparkName);
  if (!exactKey) return { row: null, confidencePct: 0, exact: false };

  for (const row of priceRows) {
    if (normalizeExactKey(row.memoDescription) === exactKey) {
      return { row, confidencePct: 100, exact: true };
    }
  }

  const fuzzyKey = normalizeFuzzyKey(sparkName);
  let best: PriceSheetRow | null = null;
  let bestScore = -1;
  for (const row of priceRows) {
    const score = similarityPercent(fuzzyKey, normalizeFuzzyKey(row.memoDescription));
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return { row: best, confidencePct: Math.max(0, bestScore), exact: false };
}

function findHeaderCol(headerRow: ExcelJS.Row, predicate: (h: string) => boolean): number {
  for (let c = 1; c <= 40; c++) {
    const h = cellText(headerRow.getCell(c).value);
    if (h && predicate(h)) return c;
  }
  return 0;
}

export function readSparkProducts(wb: ExcelJS.Workbook): SparkProductRow[] {
  const sheet = wb.getWorksheet(TAB01);
  if (!sheet) throw new Error(`Missing sheet: ${TAB01}`);

  let headerRow = 1;
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 10; c++) {
      if (/master\s*sku/i.test(cellText(sheet.getRow(r).getCell(c).value))) {
        headerRow = r;
        break;
      }
    }
  }

  const header = sheet.getRow(headerRow);
  const skuCol = findHeaderCol(header, (h) => /master\s*sku/i.test(h)) || 2;
  const nameCol = findHeaderCol(header, (h) => /product\s*name/i.test(h)) || 1;
  const priceCol =
    findHeaderCol(header, (h) => /web\s*base\s*price/i.test(h)) || 5;

  const out: SparkProductRow[] = [];
  for (let r = headerRow + 1; r <= Math.max(sheet.rowCount, 400); r++) {
    const row = sheet.getRow(r);
    const masterSku = cellText(row.getCell(skuCol).value);
    const productName = cellText(row.getCell(nameCol).value);
    if (!masterSku && !productName) continue;
    if (!masterSku) continue;
    out.push({
      masterSku,
      productName,
      webBasePrice: cellText(row.getCell(priceCol).value),
    });
  }
  return out;
}

export function readPriceSheetRows(wb: ExcelJS.Workbook): PriceSheetRow[] {
  const sheet = wb.getWorksheet(PRICE_SHEET);
  if (!sheet) throw new Error(`Missing sheet: ${PRICE_SHEET}`);

  const header = sheet.getRow(PRICE_SHEET_HEADER_ROW);
  const memoCol = findHeaderCol(header, (h) => /memo\s*\/?\s*description/i.test(h));
  const msrpCol = findHeaderCol(header, (h) => /^msrp$/i.test(h.trim()));
  const increaseCol = findHeaderCol(header, (h) => /pricing\s*increase\s*10\/01\/26/i.test(h));

  if (!memoCol || !increaseCol) {
    throw new Error(
      `Could not locate Memo/Description (col=${memoCol}) or Pricing Increase 10/01/26 (col=${increaseCol}) on row ${PRICE_SHEET_HEADER_ROW}`,
    );
  }

  const out: PriceSheetRow[] = [];
  const seen = new Set<string>();
  for (let r = PRICE_SHEET_HEADER_ROW + 1; r <= Math.max(sheet.rowCount, 2000); r++) {
    const memoDescription = cellText(sheet.getRow(r).getCell(memoCol).value);
    if (!memoDescription) continue;
    // Skip section banners (all-caps short labels without dimensions / prices)
    const pricingIncrease100126 = cellText(sheet.getRow(r).getCell(increaseCol).value);
    const msrpOld = msrpCol ? cellText(sheet.getRow(r).getCell(msrpCol).value) : "";
    if (!pricingIncrease100126 && !msrpOld) continue;

    const key = normalizeExactKey(memoDescription);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ memoDescription, msrpOld, pricingIncrease100126 });
  }
  return out;
}

export function buildAuditMap(
  sparkRows: SparkProductRow[],
  priceRows: PriceSheetRow[],
): PriceAuditMapRow[] {
  return sparkRows.map((s) => {
    const match = findBestPriceMatch(s.productName, priceRows);
    return {
      masterSku: s.masterSku,
      sparkProductName: s.productName,
      sparkCurrentPrice: s.webBasePrice,
      foundPriceSheetName: match.row?.memoDescription ?? "",
      matchConfidencePct: match.confidencePct,
      newProposedPrice1001: match.row?.pricingIncrease100126 ?? "",
      approved: "",
    };
  });
}

export function escapeCsvField(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function auditMapToCsv(rows: PriceAuditMapRow[]): string {
  const header = [
    "Master SKU",
    "Spark Product Name",
    "Spark Current Price",
    "Found Price Sheet Name",
    "Match Confidence %",
    "New Proposed Price (10/01)",
    "Approved",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsvField(r.masterSku),
        escapeCsvField(r.sparkProductName),
        escapeCsvField(r.sparkCurrentPrice),
        escapeCsvField(r.foundPriceSheetName),
        escapeCsvField(r.matchConfidencePct),
        escapeCsvField(r.newProposedPrice1001),
        escapeCsvField(r.approved),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runPriceAudit(options?: {
  sparkPath?: string;
  pricingPath?: string;
  outCsvPath?: string;
}): Promise<{
  sparkCount: number;
  priceRowCount: number;
  exactMatches: number;
  fuzzyMatches: number;
  lowConfidence: number;
  outCsvPath: string;
}> {
  const sparkPath = options?.sparkPath ?? SPARK_HANDOFF_XLSX;
  const pricingPath = options?.pricingPath ?? PRICING_UPDATE_XLSX;
  const outCsvPath = options?.outCsvPath ?? PRICE_AUDIT_CSV;

  if (!fs.existsSync(sparkPath)) throw new Error(`Missing Spark workbook: ${sparkPath}`);
  if (!fs.existsSync(pricingPath)) throw new Error(`Missing pricing workbook: ${pricingPath}`);

  // Read-only: load into memory; never writeFile on either xlsx
  const sparkWb = new ExcelJS.Workbook();
  await sparkWb.xlsx.readFile(sparkPath);

  const priceWb = new ExcelJS.Workbook();
  await priceWb.xlsx.readFile(pricingPath);

  const sparkRows = readSparkProducts(sparkWb);
  const priceRows = readPriceSheetRows(priceWb);
  const map = buildAuditMap(sparkRows, priceRows);

  fs.writeFileSync(outCsvPath, auditMapToCsv(map), "utf8");

  let exactMatches = 0;
  let fuzzyMatches = 0;
  let lowConfidence = 0;
  for (const row of map) {
    if (row.matchConfidencePct === 100) exactMatches += 1;
    else if (row.matchConfidencePct > 0) fuzzyMatches += 1;
    if (row.matchConfidencePct < 90) lowConfidence += 1;
  }

  return {
    sparkCount: sparkRows.length,
    priceRowCount: priceRows.length,
    exactMatches,
    fuzzyMatches,
    lowConfidence,
    outCsvPath,
  };
}

async function main(): Promise<void> {
  const summary = await runPriceAudit();
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        ...summary,
        note: "Review price_audit_map.csv; type Y in Approved before any injection script is authorized.",
      },
      null,
      2,
    ),
  );
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main().catch((err) => {
    console.error("[ecom:price-audit] fatal", err);
    process.exit(1);
  });
}
