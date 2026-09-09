/**
 * VividWorks contractual SKU dictionary.
 *
 * Reads docs/Vividworks/VividWorksStartingProducts.xlsx sheet "Website Products".
 * True headers are Excel row 6 (0-based index 5); data starts on row 7.
 *
 * Actual header row (do not use letter-index guesses):
 *   B / index 1  E-Commerce          (filter: checked)
 *   E / index 4  Collections
 *   I / index 8  Length              (fed to sku-engine, not written to CSV)
 *   J / index 9  Depth
 *   L / index 11 Product/Service full name  (fallback name)
 *   M / index 12 Memo/Description           (preferred Original Name)
 *   N / index 13 MSRP
 *
 * Column F is "Code" and column G is "Arm Height" — they are NOT name/MSRP.
 *
 * SKUs come only from src/lib/sku-engine.ts (generateFinishedGoodSku).
 *
 * Usage:
 *   npx tsx scripts/vividworks/01-generate-master-csv.ts
 *
 * Requires the `xlsx` package (already in package.json). No extra install.
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { generateFinishedGoodSku } from "../../src/lib/sku-engine";

const SOURCE_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/VividWorksStartingProducts.xlsx",
);
const OUTPUT_CSV = path.resolve(
  process.cwd(),
  "docs/Vividworks/vividworks_master_skus.csv",
);
const SHEET_NAME = "Website Products";
const HEADER_ROW_INDEX = 5; // Excel row 6
const DATA_START_INDEX = 6; // Excel row 7

type SourceRow = {
  excelRow: number;
  collection: string;
  originalName: string;
  msrp: string;
  length: string;
  depth: string;
  hubSku: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "";
  return String(value).trim();
}

function isEcommerceChecked(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "number" && value !== 0) return true;
  const normalized = cellText(value).toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "x" ||
    normalized === "✓" ||
    normalized === "checked"
  );
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function headerIndex(headers: unknown[], ...aliases: string[]): number {
  const wanted = aliases.map(normalizeHeader);
  return headers.findIndex((header) => wanted.includes(normalizeHeader(header)));
}

function qboDisplayName(raw: string): string {
  const trimmed = raw.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && colon < trimmed.length - 1) {
    return trimmed.slice(colon + 1).trim();
  }
  return trimmed;
}

function resolveWorkbook(): XLSX.WorkBook {
  if (!fs.existsSync(SOURCE_XLSX)) {
    throw new Error(`Missing spreadsheet: ${SOURCE_XLSX}`);
  }
  return XLSX.readFile(SOURCE_XLSX, { cellDates: false });
}

function main(): void {
  const workbook = resolveWorkbook();
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Sheet "${SHEET_NAME}" not found. Available: ${workbook.SheetNames.join(", ")}`,
    );
  }

  // Keep blank rows so index 5 remains Excel row 6.
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    sheet,
    {
      header: 1,
      defval: null,
      raw: false,
      blankrows: true,
    },
  );

  if (matrix.length <= DATA_START_INDEX) {
    throw new Error(
      `Sheet "${SHEET_NAME}" does not have data below Excel row 6.`,
    );
  }

  const headerRowIndex = (() => {
    const exact = matrix[HEADER_ROW_INDEX] ?? [];
    if (headerIndex(exact, "e-commerce", "ecommerce", "e commerce") >= 0) {
      return HEADER_ROW_INDEX;
    }
    const found = matrix.findIndex(
      (row, index) =>
        index <= 12 &&
        headerIndex(row ?? [], "e-commerce", "ecommerce", "e commerce") >= 0,
    );
    if (found >= 0) {
      console.warn(
        `[vividworks] E-Commerce header was on Excel row ${found + 1}, not row 6.`,
      );
      return found;
    }
    return HEADER_ROW_INDEX;
  })();

  const headers = matrix[headerRowIndex] ?? [];
  const dataStartIndex = headerRowIndex + 1;
  const ecommerceIdx = headerIndex(headers, "e-commerce", "ecommerce", "e commerce");
  const collectionIdx = headerIndex(headers, "collections", "collection");
  const lengthIdx = headerIndex(headers, "length");
  const depthIdx = headerIndex(headers, "depth");
  const productNameIdx = headerIndex(
    headers,
    "product service full name",
    "product/service full name",
    "product name",
  );
  const memoIdx = headerIndex(
    headers,
    "memo description",
    "memo/description",
    "description",
    "original name",
  );
  const msrpIdx = headerIndex(headers, "msrp");

  if (ecommerceIdx < 0 || collectionIdx < 0 || msrpIdx < 0) {
    throw new Error(
      `Required headers missing on row 6. Found: ${headers
        .map((h) => JSON.stringify(h))
        .join(", ")}`,
    );
  }

  if (memoIdx < 0 && productNameIdx < 0) {
    throw new Error(
      "Neither Memo/Description nor Product/Service full name found on row 6.",
    );
  }

  console.log("[vividworks] sheet:", SHEET_NAME);
  console.log(
    `[vividworks] header Excel row ${headerRowIndex + 1}:`,
    headers.filter(Boolean).join(" | "),
  );
  console.log("[vividworks] column map:", {
    ecommerce: ecommerceIdx,
    collection: collectionIdx,
    length: lengthIdx,
    depth: depthIdx,
    productName: productNameIdx,
    memo: memoIdx,
    msrp: msrpIdx,
  });

  const records: SourceRow[] = [];
  const skipped: Array<{ excelRow: number; reason: string }> = [];
  let lastCollection = "";

  for (let i = dataStartIndex; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const excelRow = i + 1;

    if (!isEcommerceChecked(row[ecommerceIdx])) {
      continue;
    }

    const collectionFromRow = cellText(row[collectionIdx]);
    if (collectionFromRow) {
      lastCollection = collectionFromRow;
    }
    const collection = collectionFromRow || lastCollection;

    const memo = memoIdx >= 0 ? cellText(row[memoIdx]) : "";
    const productName =
      productNameIdx >= 0 ? qboDisplayName(cellText(row[productNameIdx])) : "";
    const originalName = memo || productName;
    const msrp = cellText(row[msrpIdx]);
    const length = lengthIdx >= 0 ? cellText(row[lengthIdx]) : "";
    const depth = depthIdx >= 0 ? cellText(row[depthIdx]) : "";

    if (!originalName) {
      skipped.push({ excelRow, reason: "E-Commerce checked but no name/description" });
      continue;
    }
    if (!collection) {
      skipped.push({
        excelRow,
        reason: `No collection (and none to forward-fill) for "${originalName}"`,
      });
      continue;
    }

    const hubSku = generateFinishedGoodSku(
      originalName,
      collection,
      length,
      depth,
    );

    records.push({
      excelRow,
      collection,
      originalName,
      msrp,
      length,
      depth,
      hubSku,
    });
  }

  const skuCounts = new Map<string, number>();
  for (const record of records) {
    skuCounts.set(record.hubSku, (skuCounts.get(record.hubSku) ?? 0) + 1);
  }
  const collisions = [...skuCounts.entries()].filter(([, count]) => count > 1);

  const lines = [
    ["Original Name", "Canonical Hub SKU", "MSRP"].map(csvEscape).join(","),
    ...records.map((record) =>
      [record.originalName, record.hubSku, record.msrp].map(csvEscape).join(","),
    ),
  ];

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, `${lines.join("\r\n")}\r\n`, "utf8");

  console.log(`[vividworks] e-commerce rows written: ${records.length}`);
  console.log(`[vividworks] skipped: ${skipped.length}`);
  for (const row of skipped.slice(0, 20)) {
    console.warn(`  row ${row.excelRow}: ${row.reason}`);
  }
  if (skipped.length > 20) {
    console.warn(`  … ${skipped.length - 20} more skipped`);
  }
  if (collisions.length > 0) {
    console.warn(
      `[vividworks] ${collisions.length} SKU collisions (same FIN-* from different rows):`,
    );
    for (const [sku, count] of collisions.slice(0, 30)) {
      const names = records
        .filter((record) => record.hubSku === sku)
        .map((record) => `r${record.excelRow}:${record.originalName}`);
      console.warn(`  ${sku} x${count} ← ${names.join(" | ")}`);
    }
  }
  console.log(`[vividworks] wrote ${OUTPUT_CSV}`);
}

main();
