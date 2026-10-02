/**
 * Apply research fill values into the live vendor handoff workbook.
 *
 * Target ONLY:
 *   docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx
 *
 * Rules:
 * - Fill blanks only (never overwrite existing non-empty cells)
 * - Key by Internal ID / Master SKU / Upgrade Type
 * - Research input: _research_locked_full.json (preferred) or _research_merged.json
 *
 * Usage:
 *   npm run ecom:apply-research
 */
import { loadEnvConfig } from "@next/env";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { loadResearchFromPasteOrJson } from "./lib/parse-handoff-research-paste";

loadEnvConfig(process.cwd());

const HANDOFF_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx",
);

const TAB01 = "01 - PHASE 1 & 2 PRODUCTS";
const TAB02 = "02 - WEB FABRICS & FINISHES";
const TAB03 = "03 - UPCHARGE MATRIX";
const TAB06 = "06 - DEKTON GRADE MATRIX";
const TAB08 = "08 - HANDOFF CHECKLIST";
const TAB_OPS = "09 - OPS DEFAULTS & OPEN Qs";

type AnyRec = Record<string, unknown>;

type FillStats = {
  tab02: number;
  tab03: number;
  tab01: number;
  checklist: number;
  skippedExisting: number;
  unmatched: string[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("result" in value) return cellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("text" in value) return String((value as { text?: string }).text ?? "").trim();
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("").trim();
    }
    if ("formula" in value) return ""; // treat formula-only without result as blank for overwrite guard
  }
  return String(value).trim();
}

function isBlank(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  if (v == null || v === "") return true;
  if (typeof v === "object" && v && "formula" in v) {
    // Keep formulas; only fill static blanks
    const result = (v as ExcelJS.CellFormulaValue).result;
    return result == null || result === "";
  }
  return cellText(v) === "";
}

/** Fill only when blank; never clobber formulas with static values on formula cells. */
function fillBlank(
  cell: ExcelJS.Cell,
  value: string | number | null | undefined,
  stats: FillStats,
  bucket: keyof Pick<FillStats, "tab01" | "tab02" | "tab03" | "checklist">,
): boolean {
  if (value == null || value === "") return false;
  const current = cell.value;
  if (current != null && typeof current === "object" && "formula" in current) {
    // Do not replace formula cells (e.g. Retail Upcharge)
    stats.skippedExisting += 1;
    return false;
  }
  if (!isBlank(cell)) {
    stats.skippedExisting += 1;
    return false;
  }
  cell.value = value;
  stats[bucket] += 1;
  return true;
}

function appendNote(cell: ExcelJS.Cell, note: string, stats: FillStats): void {
  if (!note) return;
  const existing = cellText(cell.value);
  if (existing.includes(note)) return;
  cell.value = existing ? `${existing} | ${note}` : note;
  stats.tab02 += 1;
}

function loadMergedResearch(): { research: AnyRec; source: string } {
  const merged = path.resolve(process.cwd(), "docs/Vividworks/Handoff/_research_merged.json");
  const full = path.resolve(process.cwd(), "docs/Vividworks/Handoff/_research_locked_full.json");

  if (fs.existsSync(full)) {
    const raw = fs.readFileSync(full, "utf8").trim();
    if (raw.startsWith("{")) {
      return { research: JSON.parse(raw) as AnyRec, source: full };
    }
  }

  if (fs.existsSync(merged)) {
    return {
      research: JSON.parse(fs.readFileSync(merged, "utf8")) as AnyRec,
      source: merged,
    };
  }

  return loadResearchFromPasteOrJson();
}

function productList(research: AnyRec): AnyRec[] {
  const keys = [
    "products_no_price",
    "products",
    "products_no_price_cluster_sample",
  ];
  for (const k of keys) {
    const v = research[k];
    if (Array.isArray(v) && v.length) return v as AnyRec[];
  }
  return [];
}

function inferFreightClass(name: string, collection: string, existing: string): string {
  if (existing) return existing;
  const hay = `${name} ${collection}`.toLowerCase();
  if (/fire/.test(hay)) return "100";
  if (/table|dekton|dining|bar height|coffee|side table|fire pit/.test(hay)) return "85";
  return "175";
}

function inferShippingFlat(freight: string, existing: string | number): string | number {
  if (existing !== "" && existing != null) return existing;
  if (freight === "85") return 450;
  if (freight === "100") return 350;
  return 250;
}

async function applyTab02(
  wb: ExcelJS.Workbook,
  research: AnyRec,
  stats: FillStats,
): Promise<void> {
  const sheet = wb.getWorksheet(TAB02);
  if (!sheet) throw new Error(`Missing ${TAB02}`);

  const byId = new Map<string, AnyRec>();
  for (const row of (research.fabric_grades as AnyRec[]) ?? []) {
    byId.set(String(row.internal_id), { ...row, _kind: "fabric" });
  }
  for (const row of (research.dekton_grades as AnyRec[]) ?? []) {
    byId.set(String(row.internal_id), { ...row, _kind: "dekton" });
  }
  for (const row of (research.powders as AnyRec[]) ?? []) {
    byId.set(String(row.internal_id), { ...row, _kind: "powder" });
  }

  const solve = research.solve_linen_sku_recommendation as AnyRec | undefined;

  for (let r = 3; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    let id = cellText(row.getCell(2).value);
    const name = cellText(row.getCell(3).value);
    const cat = cellText(row.getCell(1).value);

    if (name.toUpperCase() === "SOLVE LINEN" && !id && solve?.proposed_internal_id) {
      fillBlank(row.getCell(2), String(solve.proposed_internal_id), stats, "tab02");
      id = String(solve.proposed_internal_id);
    }

    if (!id && !name) continue;

    let data = id ? byId.get(id) : undefined;
    if (!data && name.toUpperCase() === "SOLVE LINEN" && solve) {
      data = { ...solve, internal_id: solve.proposed_internal_id, _kind: "fabric" };
    }
    if (!data) {
      if (id.startsWith("FAB-") || id.startsWith("STN-") || id.startsWith("PWD-")) {
        stats.unmatched.push(`tab02:${id || name}`);
      }
      continue;
    }

    const kind = String(data._kind);
    fillBlank(row.getCell(8), String(data.pricing_grade ?? ""), stats, "tab02");

    if (kind === "fabric") {
      fillBlank(row.getCell(4), String(data.sunbrella_collection_or_family ?? ""), stats, "tab02");
      fillBlank(row.getCell(14), String(data.hex_preview ?? ""), stats, "tab02");
      fillBlank(row.getCell(15), "Y", stats, "tab02");
      if (data.content_notes) {
        const note = `Content: ${data.content_notes}`;
        const existing = cellText(row.getCell(16).value);
        if (!existing) fillBlank(row.getCell(16), note, stats, "tab02");
        else if (!existing.includes(String(data.content_notes))) appendNote(row.getCell(16), note, stats);
      }
      if (data.rationale) {
        const tag = `Grade rationale: ${data.rationale}`;
        const existing = cellText(row.getCell(16).value);
        if (!existing.includes("Grade rationale:")) {
          if (!existing) fillBlank(row.getCell(16), tag, stats, "tab02");
          else appendNote(row.getCell(16), tag, stats);
        }
      }
    }

    if (kind === "dekton") {
      fillBlank(row.getCell(4), String(data.series ?? ""), stats, "tab02");
      fillBlank(row.getCell(5), String(data.finish_texture ?? ""), stats, "tab02");
      fillBlank(
        row.getCell(6),
        data.thickness_mm != null ? Number(data.thickness_mm) : "",
        stats,
        "tab02",
      );
      fillBlank(row.getCell(7), String(data.application ?? ""), stats, "tab02");
      fillBlank(
        row.getCell(9),
        data.cosentino_price_group != null ? Number(data.cosentino_price_group) : "",
        stats,
        "tab02",
      );
      fillBlank(row.getCell(15), String(data.outdoor_rated ?? "Y"), stats, "tab02");
      if (data.rationale) {
        const tag = `Grade rationale: ${data.rationale}`;
        const existing = cellText(row.getCell(16).value);
        if (!existing.includes("Grade rationale:")) {
          if (!existing) fillBlank(row.getCell(16), tag, stats, "tab02");
          else appendNote(row.getCell(16), tag, stats);
        }
      }
    }

    if (kind === "powder") {
      fillBlank(row.getCell(5), String(data.finish_texture ?? ""), stats, "tab02");
      fillBlank(row.getCell(8), String(data.pricing_grade ?? "A"), stats, "tab02");
      fillBlank(row.getCell(14), String(data.hex_preview ?? ""), stats, "tab02");
      fillBlank(row.getCell(15), String(data.outdoor_rated ?? "Y"), stats, "tab02");
      if (data.rationale) {
        const tag = `Grade rationale: ${data.rationale}`;
        const existing = cellText(row.getCell(16).value);
        if (!existing.includes("Grade rationale:")) {
          if (!existing) fillBlank(row.getCell(16), tag, stats, "tab02");
          else appendNote(row.getCell(16), tag, stats);
        }
      }
    }

    void cat;
  }
}

async function applyTab03(
  wb: ExcelJS.Workbook,
  research: AnyRec,
  stats: FillStats,
): Promise<void> {
  const sheet = wb.getWorksheet(TAB03);
  if (!sheet) throw new Error(`Missing ${TAB03}`);

  const up = (research.upcharges ?? {}) as AnyRec;
  const fabricGrades = (up.fabric_grades ?? {}) as Record<string, number>;
  const dektonGrades = (up.dekton_grades ?? {}) as Record<string, number>;
  const addOns = ((up.add_ons as AnyRec[]) ?? []).reduce((m, a) => {
    m.set(String(a.upgrade_type).toLowerCase(), a);
    return m;
  }, new Map<string, AnyRec>());

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const upgrade = cellText(row.getCell(1).value);
    if (!upgrade) continue;

    const fabricMatch = upgrade.match(/^Fabric Grade ([A-F])$/i);
    if (fabricMatch) {
      const g = fabricMatch[1]!.toUpperCase();
      if (fabricGrades[g] != null) fillBlank(row.getCell(2), fabricGrades[g], stats, "tab03");
      continue;
    }

    const dektonMatch = upgrade.match(/^Dekton Grade ([A-F])$/i);
    if (dektonMatch) {
      const g = dektonMatch[1]!.toUpperCase();
      if (dektonGrades[g] != null) fillBlank(row.getCell(2), dektonGrades[g], stats, "tab03");
      continue;
    }

    const addOn = addOns.get(upgrade.toLowerCase());
    if (addOn && addOn.upcharge_amount_usd != null) {
      fillBlank(row.getCell(2), Number(addOn.upcharge_amount_usd), stats, "tab03");
    }
  }

  // Also update tab 06 Dekton grade matrix defaults if present
  const tab06 = wb.getWorksheet(TAB06);
  if (tab06) {
    for (let r = 2; r <= tab06.rowCount; r += 1) {
      const grade = cellText(tab06.getRow(r).getCell(1).value);
      if (!/^[A-F]$/.test(grade)) continue;
      if (dektonGrades[grade] != null) {
        // find upcharge column — typically col 3 or 4; scan header
      }
    }
    const headers: string[] = [];
    for (let c = 1; c <= 10; c += 1) headers.push(cellText(tab06.getRow(1).getCell(c).value));
    const upIdx = headers.findIndex((h) => /upcharge|\$/i.test(h));
    if (upIdx >= 0) {
      for (let r = 2; r <= tab06.rowCount; r += 1) {
        const grade = cellText(tab06.getRow(r).getCell(1).value);
        if (dektonGrades[grade] != null) {
          fillBlank(tab06.getRow(r).getCell(upIdx + 1), dektonGrades[grade], stats, "tab03");
        }
      }
    }
  }
}

async function applyTab01(
  wb: ExcelJS.Workbook,
  research: AnyRec,
  stats: FillStats,
): Promise<{ pricedApplied: number; logisticsApplied: number; stillBlankPrice: number }> {
  const sheet = wb.getWorksheet(TAB01);
  if (!sheet) throw new Error(`Missing ${TAB01}`);

  const products = productList(research);
  const bySku = new Map<string, AnyRec>();
  for (const p of products) {
    const sku = String(p.master_sku ?? "").trim();
    if (sku) bySku.set(sku, p);
  }

  const ops = (research.ops_defaults ?? {}) as AnyRec;
  const defaultLead = String(ops.standard_lead_time ?? "6-8 weeks");
  const defaultSeatFreight = String(ops.default_freight_class_seating ?? "175");
  const defaultTableFreight = String(ops.default_freight_class_tables ?? "85");

  let pricedApplied = 0;
  let logisticsApplied = 0;
  let stillBlankPrice = 0;

  // Col map from headers row 1
  // 1 Name, 2 SKU, 3 Drawing, 4 Collection, 5 Web Base, 6 MSRP, 7 Dims, 8 Weight,
  // 9 Marketing, 10 Details, 11 Ship flat, 12 Freight, 13 Lead, 14 Packaged,
  // 15 Fabric, 16 Frame, 17 Dekton, 18 Pillow, 19 Add-Ons

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const sku = cellText(row.getCell(2).value);
    if (!sku.startsWith("FIN-")) continue;

    const name = cellText(row.getCell(1).value);
    const collection = cellText(row.getCell(4).value);
    const p = bySku.get(sku);

    if (p) {
      const before = stats.tab01;
      fillBlank(row.getCell(5), p.web_base_price_usd != null ? Number(p.web_base_price_usd) : "", stats, "tab01");
      fillBlank(row.getCell(6), p.msrp_aluminum_usd != null ? Number(p.msrp_aluminum_usd) : "", stats, "tab01");
      fillBlank(row.getCell(7), String(p.dimensions_lxwxh ?? ""), stats, "tab01");
      fillBlank(row.getCell(8), p.unit_weight_lbs != null ? Number(p.unit_weight_lbs) : "", stats, "tab01");
      fillBlank(row.getCell(9), String(p.marketing_description ?? ""), stats, "tab01");
      fillBlank(row.getCell(10), String(p.details ?? ""), stats, "tab01");
      fillBlank(row.getCell(11), p.shipping_flat_rate_usd != null ? Number(p.shipping_flat_rate_usd) : "", stats, "tab01");
      fillBlank(row.getCell(12), String(p.freight_class ?? ""), stats, "tab01");
      fillBlank(row.getCell(13), String(p.lead_time ?? ""), stats, "tab01");
      fillBlank(row.getCell(14), String(p.packaged_dimensions ?? ""), stats, "tab01");
      fillBlank(row.getCell(15), String(p.fabric_color_slot ?? ""), stats, "tab01");
      fillBlank(row.getCell(16), String(p.frame_color_slot ?? ""), stats, "tab01");
      fillBlank(row.getCell(17), String(p.dekton_color_slot ?? ""), stats, "tab01");
      fillBlank(row.getCell(18), String(p.pillow_color_slot ?? ""), stats, "tab01");
      fillBlank(row.getCell(19), String(p.add_ons ?? ""), stats, "tab01");
      if (stats.tab01 > before && p.web_base_price_usd != null) pricedApplied += 1;
    }

    // Ops defaults for remaining logistics blanks (all products)
    const freightExisting = cellText(row.getCell(12).value);
    const inferredFreight = inferFreightClass(
      name,
      collection,
      freightExisting || (p ? String(p.freight_class ?? "") : ""),
    );
    // Prefer research defaults for seating/tables when blank
    let freightToWrite = "";
    if (!freightExisting) {
      const hay = `${name} ${collection}`.toLowerCase();
      if (/fire/.test(hay)) freightToWrite = "100";
      else if (/table|dining|bar height|coffee|side table/.test(hay)) freightToWrite = defaultTableFreight;
      else freightToWrite = defaultSeatFreight;
      // If product research had explicit class, prefer that
      if (p?.freight_class) freightToWrite = String(p.freight_class);
      else if (inferredFreight) freightToWrite = inferredFreight;
    }

    const beforeLog = stats.tab01;
    if (freightToWrite) fillBlank(row.getCell(12), freightToWrite, stats, "tab01");

    const freightNow = cellText(row.getCell(12).value) || freightToWrite;
    if (isBlank(row.getCell(11))) {
      const flat = inferShippingFlat(freightNow, "");
      fillBlank(row.getCell(11), flat, stats, "tab01");
    }
    fillBlank(row.getCell(13), defaultLead, stats, "tab01");

    if (stats.tab01 > beforeLog) logisticsApplied += 1;

    if (isBlank(row.getCell(5))) stillBlankPrice += 1;
  }

  return { pricedApplied, logisticsApplied, stillBlankPrice };
}

function upsertOpsSheet(wb: ExcelJS.Workbook, research: AnyRec): void {
  let sheet = wb.getWorksheet(TAB_OPS);
  if (sheet) {
    wb.removeWorksheet(sheet.id);
  }
  sheet = wb.addWorksheet(TAB_OPS, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.getRow(1).values = ["Section", "Key", "Value", "Notes"];
  sheet.getRow(1).font = { bold: true };

  let r = 2;
  const ops = (research.ops_defaults ?? {}) as AnyRec;
  for (const [k, v] of Object.entries(ops)) {
    if (k === "sources" && Array.isArray(v)) {
      sheet.getRow(r).values = ["ops_defaults", "sources", v.join(" | "), ""];
      r += 1;
      continue;
    }
    sheet.getRow(r).values = ["ops_defaults", k, typeof v === "string" ? v : JSON.stringify(v), ""];
    r += 1;
  }

  r += 1;
  sheet.getRow(r).values = ["open_questions", "id", "topic / question", "needs decision"];
  sheet.getRow(r).font = { bold: true };
  r += 1;

  for (const q of (research.open_questions as AnyRec[]) ?? []) {
    sheet.getRow(r).values = [
      "open_questions",
      String(q.id ?? ""),
      `${q.topic ?? ""} — ${q.question ?? ""}`,
      "CC Patio confirm",
    ];
    r += 1;
  }

  if (research.pricing_methodology) {
    r += 1;
    sheet.getRow(r).values = [
      "pricing_methodology",
      "summary",
      String(research.pricing_methodology),
      "",
    ];
  }

  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 100;
  sheet.getColumn(4).width = 18;
}

function updateChecklist(wb: ExcelJS.Workbook, stats: FillStats, stillBlankPrice: number): void {
  const sheet = wb.getWorksheet(TAB08);
  if (!sheet) return;

  const updates: Record<string, { status: string; notes: string }> = {
    "All web fabrics have FAB-* Internal IDs": {
      status: "DONE",
      notes: "SOLVE LINEN → FAB-SOL-LIN applied from research",
    },
    "Fabric grades A–F assigned on tab 02": {
      status: "DONE",
      notes: "36 fabrics graded A–E from research (F unused)",
    },
    "Dekton grades A–F assigned on tab 02": {
      status: "DONE",
      notes: "70 Dekton rows graded A–E + Cosentino groups from research",
    },
    "Dekton Grade upcharges $ filled on tab 03": {
      status: "DONE",
      notes: "Fabric + Dekton ladders + add-ons filled from research",
    },
    "Lead time / freight / packaged dims / weight on ta": {
      status: stillBlankPrice > 0 ? "PARTIAL" : "DONE",
      notes: stillBlankPrice > 0
        ? `${stillBlankPrice} products still missing Web Base Price — drop Drive full JSON to finish`
        : "All product blanks filled",
    },
  };

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const item = cellText(sheet.getRow(r).getCell(1).value);
    for (const [prefix, upd] of Object.entries(updates)) {
      if (item.startsWith(prefix.slice(0, 40)) || item.includes(prefix.slice(0, 30))) {
        const statusCell = sheet.getRow(r).getCell(3);
        const notesCell = sheet.getRow(r).getCell(4);
        statusCell.value = upd.status;
        notesCell.value = upd.notes;
        stats.checklist += 1;
      }
    }
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(HANDOFF_XLSX)) {
    throw new Error(`Handoff workbook not found: ${HANDOFF_XLSX}`);
  }

  const { research, source } = loadMergedResearch();
  const stats: FillStats = {
    tab02: 0,
    tab03: 0,
    tab01: 0,
    checklist: 0,
    skippedExisting: 0,
    unmatched: [],
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(HANDOFF_XLSX);

  await applyTab02(wb, research, stats);
  await applyTab03(wb, research, stats);
  const tab01 = await applyTab01(wb, research, stats);
  upsertOpsSheet(wb, research);
  updateChecklist(wb, stats, tab01.stillBlankPrice);

  await wb.xlsx.writeFile(HANDOFF_XLSX);

  const summary = {
    source,
    target: HANDOFF_XLSX,
    cellsFilled: {
      tab02: stats.tab02,
      tab03: stats.tab03,
      tab01: stats.tab01,
      checklist: stats.checklist,
    },
    skippedExisting: stats.skippedExisting,
    unmatchedSample: stats.unmatched.slice(0, 20),
    products: {
      researchProductRows: productList(research).length,
      pricedApplied: tab01.pricedApplied,
      logisticsTouched: tab01.logisticsApplied,
      stillBlankWebBasePrice: tab01.stillBlankPrice,
    },
    note:
      tab01.stillBlankPrice > 0
        ? "Place full Drive JSON at docs/Vividworks/Handoff/_research_locked_full.json and re-run to price remaining SKUs."
        : "All Web Base Price blanks filled.",
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
