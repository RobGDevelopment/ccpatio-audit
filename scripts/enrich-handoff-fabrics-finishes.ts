/**
 * Surgical enrichment of the live vendor handoff workbook.
 *
 * Target ONLY:
 *   docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx
 *
 * Preserves tabs 00 / 01 / 03 / 04 cell content (03/04 only APPEND missing rows).
 * Rebuilds tab 02 with e-comm-complete columns, dropdowns, and dynamic formulas.
 * Adds _Lists + tabs 05–08 for slot matrix, Dekton grades, VW bindings, checklist.
 *
 * Usage:
 *   npm run ecom:enrich-fabrics-finishes
 */
import { loadEnvConfig } from "@next/env";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tab02RetailUpchargeFormula,
  VW_CAPABILITY_FORCE_UUID,
  VW_CAPABILITY_ONE_TO_ONE,
  vwAssetIdFormula,
} from "./harden-spark-handoff-mq";
import { hexPreviewForInternalId } from "./lib/material-hex-preview";
import { isVendorSafeMaterialId } from "./lib/sellable-powders";
import { dektonDefaultsForId } from "./lib/dekton-tab02-defaults";

loadEnvConfig(process.cwd());

export const HANDOFF_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx",
);

export const TAB02 = "02 - WEB FABRICS & FINISHES";
export const TAB01 = "01 - PHASE 1 & 2 PRODUCTS";
export const TAB03 = "03 - UPCHARGE MATRIX";
export const TAB04 = "04 - KATANA DATA MAP";

const CSV_PATH = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/vividworks_material_options.csv",
);

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF111827" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "Calibri",
};
const NOTE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  size: 9,
  color: { argb: "FF6B7280" },
  name: "Calibri",
};

/** Expanded tab 02 headers (Swatch last so images re-anchor cleanly). */
export const TAB02_HEADERS = [
  "Material Category",
  "CC Patio Internal ID",
  "Public Display Name",
  "Brand / Series",
  "Finish / Texture",
  "Thickness (mm)",
  "Application",
  "Pricing Grade (A-F)",
  "Cosentino Price Group (0-5)",
  "Retail Upcharge ($)",
  "E-Comm Approved",
  "VW Texture / Asset Key",
  "Katana Attribute Key",
  "Hex / Preview",
  "Outdoor Rated",
  "Notes",
  "Swatch",
] as const;

export const DEKTON_GRADE_ROWS = [
  { grade: "A", cosentinoHint: "0–1", defaultUpcharge: 0, notes: "Baseline Dekton — no add to Web Base Price" },
  { grade: "B", cosentinoHint: "1–2", defaultUpcharge: null, notes: "Mid Cosentino groups — confirm retail $" },
  { grade: "C", cosentinoHint: "2–3", defaultUpcharge: null, notes: "Upper mid — confirm retail $" },
  { grade: "D", cosentinoHint: "3–4", defaultUpcharge: null, notes: "Premium groups — confirm retail $" },
  { grade: "E", cosentinoHint: "4–5", defaultUpcharge: null, notes: "High / XGloss bookmatch territory — confirm retail $" },
  { grade: "F", cosentinoHint: "5+", defaultUpcharge: null, notes: "Ultra / Design Match — confirm retail $" },
] as const;

type ExistingMaterial = {
  excelRow: number;
  internalId: string;
  category: string;
  displayName: string;
  pricingGrade: string;
  image?: { buffer: Buffer; extension: "jpeg" | "png" | "gif" };
};

type DictRow = { sku: string; category: string; name: string; cost: string };

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String((value as { text?: string }).text ?? "").trim();
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("").trim();
    }
  }
  return String(value).trim();
}

function paintHeader(sheet: ExcelJS.Worksheet, rowNumber: number, headers: readonly string[]): void {
  const row = sheet.getRow(rowNumber);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 28;
}

function parseCsvMaterials(csvPath = CSV_PATH): DictRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const out: DictRow[] = [];
  for (const line of lines.slice(1)) {
    // simple CSV: sku,category,name,cost,uom,weight
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === "," && !q) {
        cells.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cells.push(cur);
    const sku = (cells[0] ?? "").trim();
    if (!sku) continue;
    out.push({
      sku,
      category: (cells[1] ?? "").trim(),
      name: (cells[2] ?? "").trim(),
      cost: (cells[3] ?? "").trim(),
    });
  }
  return out;
}

/** Infer mm thickness from names like "ALBARIUM 1.2" / STN-DKT-ALB1.2 */
export function inferDektonThicknessMm(sku: string, name: string): string {
  const fromSku = sku.match(/(\d+)\.(\d+)$/);
  if (fromSku) {
    const whole = Number(fromSku[1]);
    const frac = Number(fromSku[2]);
    // 1.2 → 12mm, 2.0 → 20mm, 0.4 → 4mm
    if (whole === 0) return String(frac); // unlikely
    if (frac === 0) return String(whole * 10);
    return String(whole * 10 + (frac < 10 ? frac : Math.round(frac / 10)));
  }
  const fromName = name.match(/(\d+)\.(\d+)\s*$/);
  if (fromName) {
    const whole = Number(fromName[1]);
    const frac = Number(fromName[2]);
    if (frac === 0) return String(whole * 10);
    return String(whole * 10 + frac);
  }
  return "";
}

function katanaKeyForCategory(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("upholster") || c.includes("fabric")) return "cushion_fabric";
  if (c.includes("powder")) return "powder_coat";
  if (c.includes("dekton") || c.includes("stone")) return "dekton";
  return "";
}

function defaultApplication(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("upholster")) return "Cushion";
  if (c.includes("powder")) return "Frame";
  if (c.includes("dekton")) return "Tabletop / Sidearm";
  return "";
}

function defaultBrand(category: string, name: string): string {
  const c = category.toLowerCase();
  if (c.includes("upholster")) return "Sunbrella";
  if (c.includes("powder")) return "CC Patio Powder";
  if (c.includes("dekton")) {
    // light series hint from name tokens
    const upper = name.toUpperCase();
    if (/AWAKE|REVERIE|DAZE|VIGIL|MORPHEUS|LUCID|SOMNIA|NEURAL|LIMBO|TRANCE/.test(upper)) {
      return "Cosentino / Onirika";
    }
    if (/VK0|GK0|TK0|NEBBIA|SABBIA|GRAFITE|CEPPO|AVORIO|MARMORIO/.test(upper)) {
      return "Cosentino / SilverKoast";
    }
    return "Cosentino / Dekton";
  }
  return "";
}

function defaultOutdoor(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("upholster") || c.includes("dekton") || c.includes("powder")) return "Y";
  return "";
}

const CATEGORIES = new Set(["Upholstery", "Powder Coat", "Dekton"]);
const SKU_RE = /^(FAB-|PWD-|STN-)/i;
const GRADE_RE = /^[A-F]$/;
const HEADER_NOISE =
  /^(material category|cc patio internal id|public display name|brand|pricing grade|locked web)/i;

function looksLikeSku(value: string): boolean {
  return SKU_RE.test(value.trim());
}

export function normalizeMaterialRow(
  rawA: string,
  rawB: string,
  rawC: string,
  rawD: string,
  rawH: string,
  excelRow: number,
  image?: ExistingMaterial["image"],
): ExistingMaterial | null {
  if (!rawA && !rawB && !rawC) return null;
  if (HEADER_NOISE.test(rawA) || HEADER_NOISE.test(rawB) || HEADER_NOISE.test(rawC)) {
    return null;
  }

  let category = "";
  let internalId = "";
  let displayName = rawC;

  // Correct layout: A=Category, B=ID
  if (CATEGORIES.has(rawA) && (looksLikeSku(rawB) || !rawB)) {
    category = rawA;
    internalId = rawB;
  } else if (looksLikeSku(rawA) && (CATEGORIES.has(rawB) || !rawB)) {
    // Swapped layout (broken Google Sheets / prior bug): A=ID, B=Category
    internalId = rawA;
    category = rawB || (rawA.startsWith("FAB-")
      ? "Upholstery"
      : rawA.startsWith("PWD-")
        ? "Powder Coat"
        : "Dekton");
  } else if (CATEGORIES.has(rawA) && CATEGORIES.has(rawB)) {
    // Duplicate category (e.g. SOLVE LINEN row) — keep A, blank ID
    category = rawA;
    internalId = "";
  } else if (looksLikeSku(rawA)) {
    internalId = rawA;
    category = rawA.startsWith("FAB-")
      ? "Upholstery"
      : rawA.startsWith("PWD-")
        ? "Powder Coat"
        : "Dekton";
  } else if (CATEGORIES.has(rawB) && displayName) {
    category = rawB;
    internalId = looksLikeSku(rawA) ? rawA : "";
  } else if (displayName && !rawA && !rawB) {
    category = "Upholstery";
  } else {
    // Last resort: treat non-sku A as category label
    category = CATEGORIES.has(rawA) ? rawA : rawA || "Upholstery";
    internalId = looksLikeSku(rawB) ? rawB : "";
  }

  if (!displayName && !internalId && !category) return null;

  let pricingGrade = "";
  if (GRADE_RE.test(rawH)) pricingGrade = rawH;
  // Brand often leaked into H when columns shifted — ignore as grade

  void rawD; // brand reconstructed on write

  return {
    excelRow,
    internalId,
    category,
    displayName,
    pricingGrade,
    image,
  };
}

function readExistingMaterials(wb: ExcelJS.Workbook): ExistingMaterial[] {
  const sheet = wb.getWorksheet(TAB02);
  if (!sheet) throw new Error(`Missing sheet: ${TAB02}`);

  const header2 = cellText(sheet.getCell(2, 1).value).toLowerCase();
  const enriched = header2.includes("material category");
  const dataStart = enriched ? 3 : 2;

  const imageByRow = new Map<number, { buffer: Buffer; extension: "jpeg" | "png" | "gif" }>();
  for (const anchor of sheet.getImages()) {
    const range = anchor.range as {
      tl?: { nativeRow?: number; row?: number };
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
        : null);
    const buffer = rawBuffer ? Buffer.from(rawBuffer as Uint8Array) : null;
    if (!buffer || buffer.length < 200) continue;
    const extension =
      image.extension === "png" || image.extension === "gif" ? image.extension : "jpeg";
    // Prefer largest if duplicates
    const prev = imageByRow.get(excelRow);
    if (!prev || buffer.length > prev.buffer.length) {
      imageByRow.set(excelRow, { buffer, extension });
    }
  }

  const rows: ExistingMaterial[] = [];
  const seen = new Set<string>();
  for (let r = dataStart; r <= sheet.rowCount; r += 1) {
    const a = cellText(sheet.getCell(r, 1).value);
    const b = cellText(sheet.getCell(r, 2).value);
    const c = cellText(sheet.getCell(r, 3).value);
    const d = cellText(sheet.getCell(r, 4).value);
    const h = cellText(sheet.getCell(r, 8).value);
    const normalized = normalizeMaterialRow(a, b, c, d, h, r, imageByRow.get(r));
    if (!normalized) continue;
    const key = `${normalized.internalId}|${normalized.displayName}|${normalized.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
  }
  return rows;
}

function snapshotTab01(wb: ExcelJS.Workbook): { a2: string; b2: string; e2: string } {
  const sheet = wb.getWorksheet(TAB01);
  if (!sheet) throw new Error(`Missing sheet: ${TAB01}`);
  return {
    a2: cellText(sheet.getCell("A2").value),
    b2: cellText(sheet.getCell("B2").value),
    e2: cellText(sheet.getCell("E2").value),
  };
}

function ensureListsSheet(wb: ExcelJS.Workbook, dict: DictRow[], materials: ExistingMaterial[]): void {
  for (const name of ["_Lists", "99 - DICTIONARY", "99 - DICTIONARY (dropdowns)"]) {
    const existing = wb.getWorksheet(name);
    if (existing) wb.removeWorksheet(existing.id);
  }
  const lists = wb.addWorksheet("99 - DICTIONARY", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  lists.getCell("A1").value = "Category";
  ["Upholstery", "Powder Coat", "Dekton"].forEach((v, i) => {
    lists.getCell(`A${i + 2}`).value = v;
  });

  lists.getCell("B1").value = "GradeAF";
  ["A", "B", "C", "D", "E", "F"].forEach((v, i) => {
    lists.getCell(`B${i + 2}`).value = v;
  });

  lists.getCell("C1").value = "YesNo";
  lists.getCell("C2").value = "Yes";
  lists.getCell("C3").value = "No";

  lists.getCell("D1").value = "ThicknessMm";
  ["4", "8", "12", "20", "30"].forEach((v, i) => {
    lists.getCell(`D${i + 2}`).value = v;
  });

  lists.getCell("E1").value = "FinishTexture";
  ["Matte", "Velvet", "XGloss / Polished", "Textured Matte", "Ukiyo", "N/A"].forEach((v, i) => {
    lists.getCell(`E${i + 2}`).value = v;
  });

  lists.getCell("F1").value = "CosentinoGroup";
  ["0", "1", "2", "3", "4", "5"].forEach((v, i) => {
    lists.getCell(`F${i + 2}`).value = v;
  });

  lists.getCell("G1").value = "Application";
  ["Cushion", "Pillow", "Frame", "Tabletop", "Sidearm", "Tabletop / Sidearm", "N/A"].forEach(
    (v, i) => {
      lists.getCell(`G${i + 2}`).value = v;
    },
  );

  // Dictionary SKUs for ID dropdown (union of sheet IDs + CSV)
  const idSet = new Map<string, string>();
  for (const m of materials) {
    if (m.internalId) idSet.set(m.internalId, `${m.internalId} — ${m.displayName}`);
  }
  for (const d of dict) {
    if (!idSet.has(d.sku)) idSet.set(d.sku, `${d.sku} — ${d.name}`);
  }
  lists.getCell("H1").value = "InternalId";
  lists.getCell("I1").value = "DisplayFromId";
  lists.getCell("J1").value = "CategoryFromId";
  // CostFromId intentionally omitted — never ship wholesale COGS to vendors
  lists.getCell("K1").value = "FabricGradeLabel";
  lists.getCell("L1").value = "DektonGradeLabel";
  let r = 2;
  for (const [sku] of [...idSet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!isVendorSafeMaterialId(sku)) continue;
    const dictRow = dict.find((d) => d.sku === sku);
    const mat = materials.find((m) => m.internalId === sku);
    lists.getCell(`H${r}`).value = sku;
    lists.getCell(`I${r}`).value = mat?.displayName || dictRow?.name || sku;
    lists.getCell(`J${r}`).value =
      mat?.category ||
      (dictRow?.category === "Fabric"
        ? "Upholstery"
        : dictRow?.category === "Powder"
          ? "Powder Coat"
          : dictRow?.category === "Dekton"
            ? "Dekton"
            : "");
    r += 1;
  }

  ["A", "B", "C", "D", "E", "F"].forEach((g, i) => {
    lists.getCell(`K${i + 2}`).value = `Fabric Grade ${g}`;
    lists.getCell(`L${i + 2}`).value = `Dekton Grade ${g}`;
  });

  [14, 10, 8, 12, 18, 12, 18, 18, 28, 14, 18, 18].forEach((w, i) => {
    lists.getColumn(i + 1).width = w;
  });
}

function rebuildTab02(
  wb: ExcelJS.Workbook,
  materials: ExistingMaterial[],
  dict: DictRow[],
): number {
  const old = wb.getWorksheet(TAB02);
  if (old) wb.removeWorksheet(old.id);
  const sheet = wb.addWorksheet(TAB02, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });

  sheet.mergeCells(1, 1, 1, TAB02_HEADERS.length);
  sheet.getCell("A1").value =
    "LOCKED web materials for VividWorks + Woo. Col A = Category, Col B = Internal ID (FAB-/PWD-/STN-). Brand/Finish/Thickness/Application/Katana key are pre-filled. Set Pricing Grade A–F to drive Retail Upcharge from tab 03. Cosentino Price Group (0–5) is vendor reference. Use sheet 99 - DICTIONARY for ID dropdown source. Do NOT cartesian-expand into Master SKUs.";
  sheet.getCell("A1").font = NOTE_FONT;
  sheet.getRow(1).height = 36;

  paintHeader(sheet, 2, TAB02_HEADERS);

  const dictBySku = new Map(dict.map((d) => [d.sku, d]));
  const vendorMaterials = materials.filter((m) => isVendorSafeMaterialId(m.internalId));
  const idLast = 1 + Math.max(2, [...dictBySku.keys()].length + vendorMaterials.length);

  vendorMaterials.forEach((m, i) => {
    const rowNum = i + 3;
    const category = m.category || "Upholstery";
    const dektonDefaults = category === "Dekton" ? dektonDefaultsForId(m.internalId) : null;
    const thickness =
      category === "Dekton"
        ? dektonDefaults?.thicknessMm ||
          inferDektonThicknessMm(m.internalId, m.displayName) ||
          ""
        : "N/A";
    const grade = m.pricingGrade || "";
    const cosentino =
      category === "Dekton" && dektonDefaults ? dektonDefaults.cosentinoGroup : "";

    const values: Array<string | number | null> = [
      category,
      m.internalId,
      m.displayName,
      defaultBrand(category, m.displayName),
      category === "Dekton" ? "Matte" : category === "Powder Coat" ? "N/A" : "N/A",
      thickness,
      defaultApplication(category),
      grade,
      cosentino,
      null, // upcharge formula below
      "Yes",
      "", // VW asset
      katanaKeyForCategory(category),
      hexPreviewForInternalId(m.internalId),
      defaultOutdoor(category),
      category === "Dekton"
        ? "Set Pricing Grade A–F + Cosentino group; thickness inferred from SKU/name when possible"
        : category === "Upholstery" && !m.internalId
          ? "Mint FAB-* in global dictionary (e.g. SOLVE LINEN)"
          : "",
      "", // swatch col
    ];

    values.forEach((v, colIdx) => {
      const cell = sheet.getCell(rowNum, colIdx + 1);
      cell.value = v;
      cell.alignment = { vertical: "middle", wrapText: true };
      if (colIdx === 1) cell.font = { name: "Consolas", size: 10 };
    });

    // Retail upcharge: formula when grade set (Excel). Google Sheets: also works if tab 03 present.
    sheet.getCell(rowNum, 10).value = {
      formula: tab02RetailUpchargeFormula(rowNum),
    };
    sheet.getCell(rowNum, 10).numFmt = "$#,##0.00";

    // Inline lists so Google Sheets dropdowns work without relying on veryHidden sheets
    sheet.getCell(rowNum, 1).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Upholstery,Powder Coat,Dekton"'],
      showErrorMessage: true,
      errorTitle: "Category",
      error: "Pick Upholstery, Powder Coat, or Dekton.",
    };
    sheet.getCell(rowNum, 2).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'99 - DICTIONARY'!$H$2:$H$${Math.max(idLast, 50)}`],
      showErrorMessage: true,
      errorTitle: "Internal ID",
      error: "Pick a FAB-*/PWD-*/STN-* from the dictionary list.",
    };
    sheet.getCell(rowNum, 5).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Matte,Velvet,XGloss / Polished,Textured Matte,Ukiyo,N/A"'],
    };
    sheet.getCell(rowNum, 6).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"4,8,12,20,30"'],
    };
    sheet.getCell(rowNum, 7).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Cushion,Pillow,Frame,Tabletop,Sidearm,Tabletop / Sidearm,N/A"'],
    };
    sheet.getCell(rowNum, 8).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"A,B,C,D,E,F"'],
      showErrorMessage: true,
      errorTitle: "Grade",
      error: "Grade must be A–F.",
    };
    sheet.getCell(rowNum, 9).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"0,1,2,3,4,5"'],
    };
    sheet.getCell(rowNum, 11).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Yes,No"'],
    };

    if (m.image) {
      sheet.getRow(rowNum).height = 56;
      const imageId = wb.addImage({
        // exceljs Buffer typing conflicts with Node 22+ Buffer generics
        buffer: Buffer.from(m.image.buffer) as any,
        extension: m.image.extension,
      });
      sheet.addImage(imageId, {
        // Swatch is column 17 (1-based) after Dictionary Cost was removed
        tl: { col: 16, row: rowNum - 1 },
        ext: { width: 72, height: 48 },
        editAs: "oneCell",
      });
    }
  });

  const widths = [14, 18, 28, 20, 16, 12, 16, 12, 14, 14, 12, 22, 18, 12, 10, 36, 12];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: vendorMaterials.length + 2, column: TAB02_HEADERS.length },
  };

  return vendorMaterials.filter((m) => m.image).length;
}

function appendUpchargeDektonGrades(wb: ExcelJS.Workbook): number {
  const sheet = wb.getWorksheet(TAB03);
  if (!sheet) return 0;
  const existing = new Set<string>();
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    existing.add(cellText(row.getCell(1).value));
  });
  let added = 0;
  let nextRow = sheet.rowCount + 1;
  // find last used
  for (let r = sheet.rowCount; r >= 2; r -= 1) {
    if (cellText(sheet.getCell(r, 1).value)) {
      nextRow = r + 1;
      break;
    }
  }
  for (const g of DEKTON_GRADE_ROWS) {
    const label = `Dekton Grade ${g.grade}`;
    if (existing.has(label)) continue;
    sheet.getCell(nextRow, 1).value = label;
    sheet.getCell(nextRow, 2).value = g.defaultUpcharge;
    sheet.getCell(nextRow, 2).numFmt = "$#,##0.00";
    sheet.getCell(nextRow, 3).value = `${g.notes} (Cosentino groups ~${g.cosentinoHint})`;
    nextRow += 1;
    added += 1;
  }
  return added;
}

function appendKatanaMapRows(wb: ExcelJS.Workbook): number {
  const sheet = wb.getWorksheet(TAB04);
  if (!sheet) return 0;
  const existing = new Set<string>();
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    existing.add(cellText(row.getCell(1).value));
  });
  const extras: Array<[string, string]> = [
    [
      "sales_order_rows[].attributes[dekton]",
      "STN-DKT-* when product Dekton Color = Y. Line attribute — never SKU suffix. Grade drives Woo price only.",
    ],
    [
      "sales_order_rows[].attributes[pillow]",
      "Optional FAB-* for throw pillows (same fabric namespace as cushion). Attribute — not Master SKU.",
    ],
    [
      "Woo meta: dekton_grade (optional)",
      "A–F retail family for cart math. Prefer NOT sending to Katana unless factory needs it; price is Woo-side.",
    ],
    [
      "Woo meta: powder_grade (optional)",
      "Reserved — sellable powders are currently flat; use Upcharge Matrix if a premium powder $ is introduced.",
    ],
  ];
  let nextRow = sheet.rowCount + 1;
  for (let r = sheet.rowCount; r >= 2; r -= 1) {
    if (cellText(sheet.getCell(r, 1).value)) {
      nextRow = r + 1;
      break;
    }
  }
  let added = 0;
  for (const [attr, mapped] of extras) {
    if ([...existing].some((e) => e.includes(attr) || attr.includes(e))) continue;
    if (existing.has(attr)) continue;
    sheet.getCell(nextRow, 1).value = attr;
    sheet.getCell(nextRow, 1).font = { name: "Consolas", size: 10, bold: true };
    sheet.getCell(nextRow, 2).value = mapped;
    nextRow += 1;
    added += 1;
  }
  return added;
}

function buildDektonGradeMatrix(wb: ExcelJS.Workbook): void {
  const name = "06 - DEKTON GRADE MATRIX";
  if (wb.getWorksheet(name)) return;
  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] });
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value =
    "CC Patio Dekton Grades A–F (cart) mapped to Cosentino price-group guidance. Industry sources publish Groups 0–5 by color/finish; assign each STN-DKT-* a CC Patio grade on tab 02. Upcharge $ is authoritative on tab 03.";
  sheet.getCell("A1").font = NOTE_FONT;
  paintHeader(sheet, 2, [
    "Dekton Grade",
    "Cosentino Group Hint",
    "Default Upcharge ($)",
    "Typical Thickness",
    "Typical Application",
    "Notes",
  ]);
  DEKTON_GRADE_ROWS.forEach((g, i) => {
    const r = i + 3;
    sheet.getCell(r, 1).value = g.grade;
    sheet.getCell(r, 2).value = g.cosentinoHint;
    sheet.getCell(r, 3).value = g.defaultUpcharge;
    sheet.getCell(r, 3).numFmt = "$#,##0.00";
    sheet.getCell(r, 4).value = "12 or 20 (tops); 4 Slim (sidearms)";
    sheet.getCell(r, 5).value = "Tabletop / Sidearm";
    sheet.getCell(r, 6).value = g.notes;
  });
  [12, 18, 16, 28, 18, 48].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function buildSlotMatrix(wb: ExcelJS.Workbook): void {
  const name = "05 - PRODUCT SLOT MATRIX";
  if (wb.getWorksheet(name)) return;
  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] });
  const products = wb.getWorksheet(TAB01);
  if (!products) return;

  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value =
    "Auto-derived from tab 01 flags (Fabric/Frame/Dekton/Pillow/Add-Ons). VividWorks enables only these slots per FIN-*. Adjust flags on tab 01 — then re-run enrich OR copy Y/N here. Formulas reference tab 01 directly.";
  sheet.getCell("A1").font = NOTE_FONT;
  paintHeader(sheet, 2, [
    "Product Name",
    "Master SKU",
    "Fabric Slot",
    "Frame Slot",
    "Dekton Slot",
    "Pillow Slot",
    "Add-Ons",
    "Phase",
  ]);

  let outRow = 3;
  products.eachRow((row, n) => {
    if (n < 2) return;
    const productName = cellText(row.getCell(1).value);
    const sku = cellText(row.getCell(2).value);
    if (!productName || !sku.startsWith("FIN-")) return;
    sheet.getCell(outRow, 1).value = { formula: `'${TAB01}'!A${n}` };
    sheet.getCell(outRow, 2).value = { formula: `'${TAB01}'!B${n}` };
    sheet.getCell(outRow, 2).font = { name: "Consolas", size: 10 };
    sheet.getCell(outRow, 3).value = { formula: `'${TAB01}'!O${n}` };
    sheet.getCell(outRow, 4).value = { formula: `'${TAB01}'!P${n}` };
    sheet.getCell(outRow, 5).value = { formula: `'${TAB01}'!Q${n}` };
    sheet.getCell(outRow, 6).value = { formula: `'${TAB01}'!R${n}` };
    sheet.getCell(outRow, 7).value = { formula: `'${TAB01}'!S${n}` };
    sheet.getCell(outRow, 8).value = { formula: `'${TAB01}'!U${n}` };
    outRow += 1;
  });
  [40, 24, 12, 12, 12, 12, 22, 8].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: Math.max(2, outRow - 1), column: 8 },
  };
}

function buildVwAssetBindings(wb: ExcelJS.Workbook, materials: ExistingMaterial[]): void {
  const name = "07 - VW ASSET BINDINGS";
  if (wb.getWorksheet(name)) return;

  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value =
    "INSTRUCTIONS: We expect a 1:1 ID mapping between our ERP and your 3D Engine. If your engine supports custom IDs, leave the dropdown above as-is. If your engine forces system-generated UUIDs, change the dropdown, and paste your UUIDs directly over the column below.";
  sheet.getCell("A1").font = { ...NOTE_FONT, bold: true, size: 11 };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFF3CD" },
  };
  sheet.getRow(1).height = 52;

  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = "VividWorks 3D Engine Capability:";
  sheet.getCell("A2").font = { bold: true, name: "Calibri", size: 11 };
  sheet.getCell("C2").value = VW_CAPABILITY_ONE_TO_ONE;
  sheet.getCell("C2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFF00" },
  };
  sheet.getCell("C2").dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: [`"${VW_CAPABILITY_ONE_TO_ONE},${VW_CAPABILITY_FORCE_UUID}"`],
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: "Invalid option",
    error: "Select a value from the dropdown only.",
  };

  paintHeader(sheet, 3, [
    "Internal ID",
    "Category",
    "Public Display Name",
    "VW Asset / Material ID",
    "Thumbnail / Map URI",
    "Status",
  ]);
  sheet.getRow(3).getCell(4).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFF00" },
  };

  let r = 4;
  for (const m of materials) {
    if (!m.internalId && !m.displayName) continue;
    if (!isVendorSafeMaterialId(m.internalId)) continue;
    sheet.getCell(r, 1).value = m.internalId;
    sheet.getCell(r, 1).font = { name: "Consolas", size: 10 };
    sheet.getCell(r, 2).value = m.category;
    sheet.getCell(r, 3).value = m.displayName;
    sheet.getCell(r, 4).value = { formula: vwAssetIdFormula(r) };
    sheet.getCell(r, 4).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    };
    sheet.getCell(r, 5).value = "";
    sheet.getCell(r, 6).value = "PENDING";
    sheet.getCell(r, 6).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"PENDING,BOUND,N/A"'],
    };
    r += 1;
  }
  [22, 14, 28, 36, 36, 12].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function buildChecklist(wb: ExcelJS.Workbook, materials: ExistingMaterial[]): void {
  const name = "08 - HANDOFF CHECKLIST";
  if (wb.getWorksheet(name)) return;
  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  paintHeader(sheet, 1, ["Item", "Owner", "Status", "Notes"]);

  const missingSku = materials.filter((m) => m.category === "Upholstery" && !m.internalId);
  const ungadedFab = materials.filter(
    (m) => m.category === "Upholstery" && m.internalId && !m.pricingGrade,
  );
  const ungadedDek = materials.filter((m) => m.category === "Dekton" && !m.pricingGrade);

  const items: Array<[string, string, string, string]> = [
    [
      "All web fabrics have FAB-* Internal IDs",
      "Architecture",
      missingSku.length ? "OPEN" : "DONE",
      missingSku.map((m) => m.displayName).join(", ") || "OK",
    ],
    [
      "Fabric grades A–F assigned on tab 02",
      "Sales / Merch",
      ungadedFab.length ? "OPEN" : "DONE",
      `${ungadedFab.length} fabric rows missing grade`,
    ],
    [
      "Dekton grades A–F assigned on tab 02",
      "Sales / Merch",
      ungadedDek.length ? "OPEN" : "DONE",
      `${ungadedDek.length} Dekton rows missing grade — use tab 06 guidance`,
    ],
    [
      "Dekton Grade upcharges $ filled on tab 03",
      "Sales",
      "OPEN",
      "Grade A = $0; B–F require retail $",
    ],
    [
      "Products with Dekton=Y have ≥1 approved STN-*",
      "Architecture",
      "OPEN",
      "Cross-check tab 05 Dekton Slot vs tab 02 E-Comm Approved Dekton",
    ],
    [
      "Lead time / freight / packaged dims / weight on tab 01",
      "Ops / Logistics",
      "OPEN",
      "Many Phase 1/2 rows still blank",
    ],
    [
      "VividWorks texture bindings (tab 07)",
      "VividWorks",
      "OPEN",
      "Every approved material needs VW Asset ID",
    ],
    [
      "Katana FIN-* published for every tab 01 Master SKU",
      "MDM / Architecture",
      "OPEN",
      "Fail closed if GET /variants?sku=FIN-… missing",
    ],
    [
      "Woo line sku = Master SKU; attrs not SKU suffixes",
      "PrimeView",
      "OPEN",
      "See tab 04 + CAPITAL_STACK_VENDOR_HANDOFF.md",
    ],
    [
      "Pillow vs cushion fabric rules documented",
      "Architecture + VW",
      "OPEN",
      "Same FAB-* namespace; separate cart line / attribute",
    ],
  ];

  items.forEach((row, i) => {
    const r = i + 2;
    row.forEach((v, c) => {
      sheet.getCell(r, c + 1).value = v;
    });
    sheet.getCell(r, 3).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"OPEN,DONE,BLOCKED,N/A"'],
    };
  });
  [56, 18, 10, 56].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

export type EnrichResult = {
  outPath: string;
  materials: number;
  imagesRestored: number;
  dektonGradesAdded: number;
  katanaRowsAdded: number;
  tab01Snapshot: { a2: string; b2: string; e2: string };
  tab01After: { a2: string; b2: string; e2: string };
};

export async function enrichHandoffFabricsFinishes(
  filePath = HANDOFF_XLSX,
): Promise<EnrichResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Handoff workbook not found: ${filePath}`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const tab01Snapshot = snapshotTab01(wb);
  const materialsRaw = readExistingMaterials(wb);
  if (materialsRaw.length === 0) {
    throw new Error("Tab 02 has no material rows to enrich.");
  }
  const catOrder = (c: string) =>
    c === "Upholstery" ? 0 : c === "Powder Coat" ? 1 : c === "Dekton" ? 2 : 3;
  const materials = [...materialsRaw].sort((a, b) => {
    const d = catOrder(a.category) - catOrder(b.category);
    if (d !== 0) return d;
    return (a.internalId || a.displayName).localeCompare(b.internalId || b.displayName);
  });
  const dict = parseCsvMaterials();

  ensureListsSheet(wb, dict, materials);
  const imagesRestored = rebuildTab02(wb, materials, dict);
  const dektonGradesAdded = appendUpchargeDektonGrades(wb);
  const katanaRowsAdded = appendKatanaMapRows(wb);
  buildSlotMatrix(wb);
  buildDektonGradeMatrix(wb);
  buildVwAssetBindings(wb, materials);
  buildChecklist(wb, materials);

  // Restore a stable tab order for vendors via worksheet.orderNo.
  const desiredOrder = [
    "00 - EXECUTIVE SUMMARY",
    "01 - PHASE 1 & 2 PRODUCTS",
    "02 - WEB FABRICS & FINISHES",
    "03 - UPCHARGE MATRIX",
    "04 - KATANA DATA MAP",
    "05 - PRODUCT SLOT MATRIX",
    "06 - DEKTON GRADE MATRIX",
    "07 - VW ASSET BINDINGS",
    "08 - HANDOFF CHECKLIST",
    "99 - DICTIONARY",
  ];
  desiredOrder.forEach((name, index) => {
    const sheet = wb.getWorksheet(name) as (ExcelJS.Worksheet & { orderNo?: number }) | undefined;
    if (sheet) sheet.orderNo = index + 1;
  });
  // Any unexpected sheets go after
  let extra = desiredOrder.length + 1;
  wb.eachSheet((sheet) => {
    if (!desiredOrder.includes(sheet.name)) {
      (sheet as ExcelJS.Worksheet & { orderNo?: number }).orderNo = extra;
      extra += 1;
    }
  });

  // Drop legacy hidden _Lists if somehow still present
  const legacy = wb.getWorksheet("_Lists");
  if (legacy) wb.removeWorksheet(legacy.id);

  await wb.xlsx.writeFile(filePath);

  const verify = new ExcelJS.Workbook();
  await verify.xlsx.readFile(filePath);
  const tab01After = snapshotTab01(verify);

  return {
    outPath: filePath,
    materials: materials.length,
    imagesRestored,
    dektonGradesAdded,
    katanaRowsAdded,
    tab01Snapshot,
    tab01After,
  };
}

async function main(): Promise<void> {
  const result = await enrichHandoffFabricsFinishes();
  if (
    result.tab01Snapshot.a2 !== result.tab01After.a2 ||
    result.tab01Snapshot.b2 !== result.tab01After.b2 ||
    result.tab01Snapshot.e2 !== result.tab01After.e2
  ) {
    throw new Error(
      `Tab 01 integrity check failed. Before=${JSON.stringify(result.tab01Snapshot)} After=${JSON.stringify(result.tab01After)}`,
    );
  }
  console.log("[ecom:enrich-fabrics-finishes] wrote", result.outPath);
  console.log("[ecom:enrich-fabrics-finishes] counts", {
    materials: result.materials,
    imagesRestored: result.imagesRestored,
    dektonGradesAdded: result.dektonGradesAdded,
    katanaRowsAdded: result.katanaRowsAdded,
    tab01Preserved: true,
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main().catch((error: unknown) => {
    console.error("[ecom:enrich-fabrics-finishes] fatal", error);
    process.exitCode = 1;
  });
}
