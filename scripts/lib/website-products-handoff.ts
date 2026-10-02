/**
 * Extract e-commerce product rows (+ drawing images) from the
 * "Copy of Website Products" tab in the Vividworks/Primeview handoff workbook.
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

export const WEBSITE_PRODUCTS_HANDOFF = path.resolve(
  process.cwd(),
  "docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx",
);

export const WEBSITE_PRODUCTS_SHEET = "Copy of Website Products";

/** Header row in the Website Products sheet (1-based). */
export const WEBSITE_HEADER_ROW = 6;

export type WebsiteProductRow = {
  sourceRow: number;
  ecommerce: boolean;
  shippingFlatRate: string;
  collection: string;
  code: string;
  armHeight: string;
  sitHeight: string;
  length: string;
  depth: string;
  height: string;
  fullName: string;
  memo: string;
  msrp: number | null;
  msrpAluminum: number | null;
  description: string;
  details: string;
  weight: string;
  packagedHeight: string;
  fabricColor: string;
  frameColor: string;
  dektonColor: string;
  pillowColor: string;
  addOns: string;
  /** Drawing swatch bytes when present. */
  imageBuffer: Buffer | null;
  imageExtension: "jpeg" | "png" | "gif" | null;
};

export type SowProductRef = {
  name: string;
  phase: 1 | 2;
  masterSku: string;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String((value as { text?: string }).text ?? "").trim();
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText
        .map((t) => t.text)
        .join("")
        .trim();
    }
  }
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value && "result" in value) {
    return cellNumber(value.result as ExcelJS.CellValue);
  }
  const text = cellText(value).replace(/[$,]/g, "");
  if (!text || text.toUpperCase() === "N/A") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function isTruthyEcom(value: ExcelJS.CellValue): boolean {
  if (value === true || value === 1) return true;
  const t = cellText(value).toUpperCase();
  return t === "TRUE" || t === "YES" || t === "Y" || t === "1";
}

export function normalizeProductKey(raw: string): string {
  return String(raw)
    .toUpperCase()
    .replace(/[''″"″]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 .X]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatWebsiteDimensions(row: WebsiteProductRow): string {
  const L = row.length.replace(/[''″"]/g, "").trim();
  const D = row.depth.replace(/[''″"]/g, "").trim();
  const H = row.height.replace(/[''″"]/g, "").trim();
  if (L && D && H) return `${L} x ${D} x ${H}`;
  if (L && D) return `${L} x ${D}`;
  if (L) return L;
  return "";
}

function tokenScore(a: string, b: string): number {
  const na = normalizeProductKey(a);
  const nb = normalizeProductKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2 && t !== "AND"));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2 && t !== "AND"));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return (hit / Math.max(ta.size, tb.size)) * 70;
}

/**
 * Unique best-match map: SOW product name → website row.
 * Prefers memo over fullName; requires score >= minScore.
 */
export function matchWebsiteProductsToSow(
  sowProducts: SowProductRef[],
  websiteRows: WebsiteProductRow[],
  mintSku: (name: string) => string,
  minScore = 55,
): Map<string, WebsiteProductRow> {
  type Pair = { sowName: string; web: WebsiteProductRow; score: number };
  const pairs: Pair[] = [];

  for (const sow of sowProducts) {
    for (const web of websiteRows) {
      if (!web.ecommerce) continue;
      const label = web.memo || web.fullName;
      if (!label) continue;

      let score = Math.max(
        tokenScore(sow.name, web.memo),
        tokenScore(sow.name, web.fullName),
      );

      // Bonus when FIN-* minted from website memo equals SOW Master SKU
      try {
        if (web.memo && mintSku(web.memo) === sow.masterSku) score += 25;
      } catch {
        // ignore mint failures on odd website strings
      }

      if (score >= minScore) pairs.push({ sowName: sow.name, web, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedSow = new Set<string>();
  const usedWeb = new Set<number>();
  const out = new Map<string, WebsiteProductRow>();

  for (const pair of pairs) {
    if (usedSow.has(pair.sowName) || usedWeb.has(pair.web.sourceRow)) continue;
    usedSow.add(pair.sowName);
    usedWeb.add(pair.web.sourceRow);
    out.set(pair.sowName, pair.web);
  }
  return out;
}

function buildImageIndex(
  sheet: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
): Map<number, { buffer: Buffer; extension: "jpeg" | "png" | "gif" }> {
  const byExcelRow = new Map<
    number,
    { buffer: Buffer; extension: "jpeg" | "png" | "gif"; area: number }
  >();

  for (const anchor of sheet.getImages()) {
    const range = anchor.range as {
      tl?: { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
      ext?: { width?: number; height?: number };
    };
    const nativeRow = range.tl?.nativeRow;
    const row0 = range.tl?.row;
    const excelRow =
      typeof nativeRow === "number"
        ? nativeRow + 1
        : typeof row0 === "number"
          ? Math.floor(row0) + 1
          : null;
    if (excelRow == null) continue;

    // Drawing column is col D (index 3) — skip logo/header images far right
    const nativeCol = range.tl?.nativeCol ?? range.tl?.col ?? 0;
    if (typeof nativeCol === "number" && nativeCol >= 10) continue;

    let image: ExcelJS.Image;
    try {
      image = wb.getImage(Number(anchor.imageId));
    } catch {
      continue;
    }
    const rawBuffer =
      image.buffer ??
      (image.base64
        ? Buffer.from(image.base64.replace(/^data:image\/\w+;base64,/, ""), "base64")
        : image.filename && fs.existsSync(image.filename)
          ? fs.readFileSync(image.filename)
          : null);
    const buffer = rawBuffer ? Buffer.from(rawBuffer as Uint8Array) : null;
    if (!buffer || buffer.length < 500) continue;

    const extension =
      image.extension === "png" || image.extension === "gif"
        ? image.extension
        : "jpeg";
    const area = (range.ext?.width ?? 100) * (range.ext?.height ?? 100);
    const prev = byExcelRow.get(excelRow);
    if (!prev || area > prev.area) {
      byExcelRow.set(excelRow, { buffer, extension, area });
    }
  }

  const out = new Map<number, { buffer: Buffer; extension: "jpeg" | "png" | "gif" }>();
  for (const [row, val] of byExcelRow) {
    out.set(row, { buffer: val.buffer, extension: val.extension });
  }
  return out;
}

export function extractWebsiteProductsFromWorkbook(
  wb: ExcelJS.Workbook,
  sheetName = WEBSITE_PRODUCTS_SHEET,
): WebsiteProductRow[] {
  const sheet = wb.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const imagesByRow = buildImageIndex(sheet, wb);
  const rows: WebsiteProductRow[] = [];

  for (let r = WEBSITE_HEADER_ROW + 1; r <= sheet.rowCount; r += 1) {
    const fullName = cellText(sheet.getCell(r, 12).value);
    const memo = cellText(sheet.getCell(r, 13).value);
    const ecommerce = isTruthyEcom(sheet.getCell(r, 2).value);
    if (!fullName && !memo) continue;
    // Section banners (e.g. "SOFAS, CHAISES...") live in Drawing col with no product name
    const drawingText = cellText(sheet.getCell(r, 4).value);
    if (!fullName && !memo && drawingText) continue;
    if (!ecommerce && !fullName && !memo) continue;

    const img = imagesByRow.get(r) ?? null;
    rows.push({
      sourceRow: r,
      ecommerce,
      shippingFlatRate: cellText(sheet.getCell(r, 3).value),
      collection: cellText(sheet.getCell(r, 5).value),
      code: cellText(sheet.getCell(r, 6).value),
      armHeight: cellText(sheet.getCell(r, 7).value),
      sitHeight: cellText(sheet.getCell(r, 8).value),
      length: cellText(sheet.getCell(r, 9).value),
      depth: cellText(sheet.getCell(r, 10).value),
      height: cellText(sheet.getCell(r, 11).value),
      fullName,
      memo,
      msrp: cellNumber(sheet.getCell(r, 14).value),
      msrpAluminum: cellNumber(sheet.getCell(r, 15).value),
      description: cellText(sheet.getCell(r, 16).value),
      details: cellText(sheet.getCell(r, 17).value),
      weight: cellText(sheet.getCell(r, 18).value),
      packagedHeight: cellText(sheet.getCell(r, 19).value),
      fabricColor: cellText(sheet.getCell(r, 20).value),
      frameColor: cellText(sheet.getCell(r, 21).value),
      dektonColor: cellText(sheet.getCell(r, 22).value),
      pillowColor: cellText(sheet.getCell(r, 23).value),
      addOns: cellText(sheet.getCell(r, 24).value),
      imageBuffer: img?.buffer ?? null,
      imageExtension: img?.extension ?? null,
    });
  }

  return rows;
}

export async function loadWebsiteProductsFromHandoff(
  filePath = WEBSITE_PRODUCTS_HANDOFF,
): Promise<WebsiteProductRow[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Website products handoff not found: ${filePath}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return extractWebsiteProductsFromWorkbook(wb);
}

/** Unique add-on labels from website rows (for Upcharge Matrix seeding). */
export function collectWebsiteAddOns(rows: WebsiteProductRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (!row.ecommerce) continue;
    for (const part of row.addOns.split(/[,;/|]/)) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      if (/^(N\/?A|N|A|-)$/i.test(cleaned)) continue;
      set.add(cleaned);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
