/**
 * True Excel → sku_mappings ingestion (cell-level, not heuristics).
 *
 * Reads factory workbooks from docs/data_sheets/ and merges into the PIM hub
 * by matching spreadsheet identity → sku_mappings.global_sku (with name /
 * Base-SKU fallbacks where the sheet key is not the E2E SKU).
 *
 * Sources:
 *   1. Website Product Info.xlsx → Finished Goods dims + MSRP
 *      Sheet "Website Products w Links" (header row = Excel row 5)
 *   2. CC Patio - Purchasing Database (v2 2026-08-19).xlsx → Metal/Powder UOM + cost
 *      Sheet "Item Catalog"
 *   3. CURRENT DEKTON UPDATED 7.23.26.xlsx → thickness_mm
 *      Sheet "Slab Locations"
 *   4. CURRENT Fabric Control Inventory 2026-CURRENT.xlsx → fabric pattern + vendor SKU
 *      Sheet "CATALOGO"
 *
 * Safety (idempotent):
 *   - Skip any sku_mappings row with version > 1 (manual edits today)
 *   - On version ≤ 1, Excel cell values win for mapped fields (replaces
 *     any prior heuristic fillers). Re-runs are stable once DB matches Excel.
 *   - Do not bump version (system ingest keeps OCC baseline at 1)
 *
 * Usage (from middleware/):
 *   npx tsx scripts/ingest-excel-data.ts
 *   npx tsx scripts/ingest-excel-data.ts --dry-run
 *
 * Phase 3 (Multi-Level BOM) is intentionally out of scope — do not run until
 * this ingest is verified.
 */
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "../src/server/db/schema";
import {
  normalizePimCategory,
  parseCategoryAttributes,
} from "../src/server/pim/attributes";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run");
const UPDATED_BY = "ingest-excel-data";

const DATA_SHEETS = path.resolve(process.cwd(), "..", "docs", "data_sheets");

const FILES = {
  website: "Website Product Info.xlsx",
  purchasing: "CC Patio - Purchasing Database (v2 2026-08-19).xlsx",
  dekton: "CURRENT DEKTON UPDATED 7.23.26.xlsx",
  fabric: "CURRENT Fabric Control Inventory 2026-CURRENT.xlsx",
} as const;

type MappingRow = {
  global_sku: string;
  category: string;
  original_name: string;
  version: number;
  uom_purchase: string | null;
  uom_consume: string | null;
  base_cost: string | null;
  attributes: Record<string, unknown> | null;
};

type FgExcel = {
  baseSku: string;
  collection: string | null;
  armHeight: string | null;
  sitHeight: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  productName: string | null;
  memo: string | null;
  msrp: string | null;
};

type PurchaseExcel = {
  itemName: string;
  unit: string | null;
  unitPrice: string | null;
  skuSpec: string | null;
  operation: string | null;
  department: string | null;
};

type Stats = {
  examined: number;
  updated: number;
  skippedVersion: number;
  skippedNoChange: number;
  unmatchedExcel: number;
};

function requireFile(fileName: string): string {
  const full = path.join(DATA_SHEETS, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing spreadsheet: ${full}`);
  }
  return full;
}

function cellStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t.length > 0 ? t : null;
}

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/['"]+/g, "")
    .replace(/\s+/g, " ");
}

function cleanDim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim().replace(/['"]+/g, "").replace(/\s+/g, "");
  return t.length > 0 ? t : null;
}

function parseMoney(value: string | null | undefined): string | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

/**
 * Merge Excel-sourced attrs into existing. Excel non-empty leaves win
 * (this is the true SoT pass — may replace prior heuristic fillers on version=1).
 * Leaves present only in existing are preserved.
 */
function mergeAttributesExcelWins(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, nextVal] of Object.entries(incoming)) {
    const curVal = out[key];
    if (
      nextVal &&
      typeof nextVal === "object" &&
      !Array.isArray(nextVal) &&
      curVal &&
      typeof curVal === "object" &&
      !Array.isArray(curVal)
    ) {
      out[key] = mergeAttributesExcelWins(
        curVal as Record<string, unknown>,
        nextVal as Record<string, unknown>,
      );
      continue;
    }
    if (!isEmptyValue(nextVal)) {
      out[key] = nextVal;
    }
  }
  return out;
}

function sheetRows(
  filePath: string,
  sheetName: string,
  opts?: { range?: number },
): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in ${path.basename(filePath)}`);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    ...(opts?.range != null ? { range: opts.range } : {}),
  });
}

/**
 * Match Website "Base SKU" (e.g. BRV-SWV-34X34) to hub FIN-* SKU
 * (e.g. FIN-BRV-SWV-CHA-34X34): first two tokens + trailing size token.
 */
function matchFgBaseSku(globalSku: string, baseSku: string): boolean {
  const g = globalSku.replace(/^FIN-/i, "").toUpperCase();
  const b = baseSku.toUpperCase().trim();
  if (!b) return false;
  if (g === b || g.endsWith(b) || g.includes(b)) return true;
  const gt = g.split("-").filter(Boolean);
  const bt = b.split("-").filter(Boolean);
  if (bt.length < 2 || gt.length < 2) return false;
  return (
    gt[0] === bt[0] &&
    gt[1] === bt[1] &&
    gt[gt.length - 1] === bt[bt.length - 1]
  );
}

function nameLooksLike(productOrMemo: string | null, originalName: string): boolean {
  const a = normalizeKey(productOrMemo).split(":")[0]?.trim() ?? "";
  const b = normalizeKey(originalName);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function fgRowScore(row: FgExcel): number {
  let score = 0;
  if (row.collection) score += 4;
  if (row.armHeight || row.sitHeight) score += 3;
  if (row.length && row.depth && row.height) score += 2;
  if (row.msrp) score += 1;
  if (row.productName || row.memo) score += 1;
  return score;
}

function loadFinishedGoodsExcel(): FgExcel[] {
  const rows = sheetRows(requireFile(FILES.website), "Website Products w Links", {
    // Title block occupies Excel rows 1–4; headers are on row 5 → 0-based range 4
    range: 4,
  });
  const out: FgExcel[] = [];
  for (const r of rows) {
    const baseSku = cellStr(r["Base SKU"]);
    if (!baseSku) continue;
    // Skip section banners accidentally parsed as data
    if (!/[A-Z0-9]+-[A-Z0-9]+/i.test(baseSku)) continue;
    out.push({
      baseSku: baseSku.toUpperCase(),
      collection: cellStr(r.Collections),
      armHeight: cellStr(r["Arm Height"]),
      sitHeight: cellStr(r["Sit Height"]),
      length: cellStr(r.Length),
      depth: cellStr(r.Depth),
      height: cellStr(r.Height),
      productName: cellStr(r["Product/Service full name"]),
      memo: cellStr(r["Memo/Description"]),
      msrp: cellStr(r.MSRP),
    });
  }
  return out;
}

function pickFgExcel(mapping: MappingRow, excelRows: FgExcel[]): FgExcel | null {
  const byBase = excelRows.filter((e) => matchFgBaseSku(mapping.global_sku, e.baseSku));
  const candidates =
    byBase.length > 0
      ? byBase
      : excelRows.filter(
          (e) =>
            nameLooksLike(e.productName, mapping.original_name) ||
            nameLooksLike(e.memo, mapping.original_name),
        );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => fgRowScore(b) - fgRowScore(a))[0]!;
}

function loadPurchasingExcel(): PurchaseExcel[] {
  const rows = sheetRows(requireFile(FILES.purchasing), "Item Catalog");
  const out: PurchaseExcel[] = [];
  for (const r of rows) {
    const itemName = cellStr(r["Item Name"]);
    if (!itemName) continue;
    out.push({
      itemName,
      unit: cellStr(r.Unit),
      unitPrice: cellStr(r["Unit Price ($)"]),
      skuSpec: cellStr(r["SKU / Spec"]),
      operation: cellStr(r.Operation),
      department: cellStr(r.Department),
    });
  }
  return out;
}

function pickPurchaseExcel(
  mapping: MappingRow,
  excelRows: PurchaseExcel[],
): PurchaseExcel | null {
  const nameKey = normalizeKey(mapping.original_name);
  const byName = excelRows.find((e) => normalizeKey(e.itemName) === nameKey);
  if (byName) return byName;

  // MET-{SKU/Spec} / PWD-* when Spec is a clean token present in global_sku
  const sku = mapping.global_sku.toUpperCase();
  for (const e of excelRows) {
    const spec = cellStr(e.skuSpec);
    if (!spec) continue;
    const compact = spec.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (compact.length < 3) continue;
    if (sku === `MET-${compact}` || sku.endsWith(`-${compact}`)) return e;
  }
  return null;
}

function loadDektonThicknessByMaterial(): Map<string, number> {
  const rows = sheetRows(requireFile(FILES.dekton), "Slab Locations");
  const map = new Map<string, number>();
  for (const r of rows) {
    const material = cellStr(r.Material);
    const thickCm = cellStr(r["Thickness (cm)"]);
    if (!material || !thickCm) continue;
    const cm = Number(String(thickCm).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(cm) || cm <= 0) continue;
    const key = normalizeKey(material);
    // First thickness wins (slabs of same material share cm)
    if (!map.has(key)) map.set(key, cm);
  }
  return map;
}

type FabricExcel = {
  fabric: string;
  vendorSku: string | null;
};

function loadFabricExcel(): FabricExcel[] {
  const rows = sheetRows(requireFile(FILES.fabric), "CATALOGO");
  const out: FabricExcel[] = [];
  for (const r of rows) {
    const fabric = cellStr(r.FABRIC);
    if (!fabric) continue;
    out.push({
      fabric,
      vendorSku: cellStr(r.SKU),
    });
  }
  return out;
}

function pickFabricExcel(
  mapping: MappingRow,
  excelRows: FabricExcel[],
): FabricExcel | null {
  const key = normalizeKey(mapping.original_name);
  return excelRows.find((e) => normalizeKey(e.fabric) === key) ?? null;
}

function buildFgAttributes(excel: FgExcel): Record<string, unknown> {
  const dimensions: Record<string, unknown> = {};
  const l = cleanDim(excel.length);
  const d = cleanDim(excel.depth);
  const h = cleanDim(excel.height);
  const seat = cleanDim(excel.sitHeight);
  const arm = cleanDim(excel.armHeight);
  if (l) dimensions.l = l;
  if (d) dimensions.d = d;
  if (h) dimensions.h = h;
  if (seat) dimensions.seat_h = seat;
  if (arm) dimensions.arm_h = arm;

  const attrs: Record<string, unknown> = {};
  if (excel.collection) {
    attrs.taxonomy = { collection: excel.collection.trim() };
  }
  if (Object.keys(dimensions).length > 0) attrs.dimensions = dimensions;
  return attrs;
}

function buildDektonAttributes(thicknessCm: number): Record<string, unknown> {
  return {
    thickness_mm: String(Math.round(thicknessCm * 10)),
  };
}

function buildFabricAttributes(excel: FabricExcel): Record<string, unknown> {
  const toks = excel.fabric.trim().split(/\s+/).filter(Boolean);
  const brand = toks[0] ?? excel.fabric;
  const colorway = toks.slice(1).join(" ") || undefined;
  const attrs: Record<string, unknown> = {
    pattern: {
      name: brand,
      ...(colorway ? { colorway } : {}),
    },
  };
  if (excel.vendorSku) {
    attrs.supply_chain = { sku: excel.vendorSku };
  }
  return attrs;
}

async function upsertFinishedGoodsCatalog(
  db: ReturnType<typeof getDb>,
  globalSku: string,
  excel: FgExcel,
): Promise<boolean> {
  const [existing] = await db
    .select({
      global_sku: finished_goods_catalog.global_sku,
      msrp: finished_goods_catalog.msrp,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      arm_height: finished_goods_catalog.arm_height,
      sit_height: finished_goods_catalog.sit_height,
      description: finished_goods_catalog.description,
    })
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, globalSku))
    .limit(1);

  if (!existing) return false;

  // Excel wins for mapped commerce fields when present
  const next = {
    msrp: excel.msrp || existing.msrp?.trim() || null,
    length: cleanDim(excel.length) || existing.length?.trim() || null,
    depth: cleanDim(excel.depth) || existing.depth?.trim() || null,
    height: cleanDim(excel.height) || existing.height?.trim() || null,
    arm_height: cleanDim(excel.armHeight) || existing.arm_height?.trim() || null,
    sit_height: cleanDim(excel.sitHeight) || existing.sit_height?.trim() || null,
    description:
      excel.memo ||
      excel.productName ||
      existing.description?.trim() ||
      null,
  };

  const changed =
    next.msrp !== (existing.msrp ?? null) ||
    next.length !== (existing.length ?? null) ||
    next.depth !== (existing.depth ?? null) ||
    next.height !== (existing.height ?? null) ||
    next.arm_height !== (existing.arm_height ?? null) ||
    next.sit_height !== (existing.sit_height ?? null) ||
    next.description !== (existing.description ?? null);

  if (!changed) return false;

  if (!DRY_RUN) {
    await db
      .update(finished_goods_catalog)
      .set({
        ...next,
        updated_by: UPDATED_BY,
        updated_at: new Date(),
      })
      .where(eq(finished_goods_catalog.global_sku, globalSku));
  }
  return true;
}

async function applyMappingUpdate(
  db: ReturnType<typeof getDb>,
  mapping: MappingRow,
  patch: {
    uom_purchase?: string | null;
    uom_consume?: string | null;
    base_cost?: string | null;
    attributes?: Record<string, unknown>;
  },
  stats: Stats,
  sampleLabel: string,
): Promise<void> {
  stats.examined += 1;

  if (mapping.version > 1) {
    stats.skippedVersion += 1;
    return;
  }

  const currentAttrs =
    mapping.attributes && typeof mapping.attributes === "object"
      ? mapping.attributes
      : {};
  const incomingAttrs = patch.attributes
    ? parseCategoryAttributes(mapping.category, patch.attributes)
    : {};
  const mergedAttrs = parseCategoryAttributes(
    mapping.category,
    mergeAttributesExcelWins(currentAttrs, incomingAttrs),
  );

  // Excel-provided relational values win on version ≤ 1
  const nextPurchase =
    patch.uom_purchase?.trim() || mapping.uom_purchase?.trim() || null;
  const nextConsume =
    patch.uom_consume?.trim() || mapping.uom_consume?.trim() || null;
  const nextCost =
    patch.base_cost?.trim() || mapping.base_cost?.trim() || null;

  const attrsChanged =
    JSON.stringify(currentAttrs) !== JSON.stringify(mergedAttrs);
  const relationalChanged =
    nextPurchase !== (mapping.uom_purchase ?? null) ||
    nextConsume !== (mapping.uom_consume ?? null) ||
    nextCost !== (mapping.base_cost ?? null);

  if (!attrsChanged && !relationalChanged) {
    stats.skippedNoChange += 1;
    return;
  }

  stats.updated += 1;
  if (DRY_RUN && stats.updated <= 12) {
    console.log(`[dry-run] ${sampleLabel} ${mapping.global_sku}`, {
      uom_purchase: nextPurchase,
      uom_consume: nextConsume,
      base_cost: nextCost,
      attributes: mergedAttrs,
    });
  }

  if (!DRY_RUN) {
    await db
      .update(sku_mappings)
      .set({
        uom_purchase: nextPurchase,
        uom_consume: nextConsume,
        base_cost: nextCost,
        attributes: mergedAttrs,
        updated_by: UPDATED_BY,
        updated_at: new Date(),
      })
      .where(eq(sku_mappings.global_sku, mapping.global_sku));
  }
}

async function main(): Promise<void> {
  console.log(`[ingest] data_sheets=${DATA_SHEETS} dryRun=${DRY_RUN}`);

  for (const file of Object.values(FILES)) {
    requireFile(file);
  }

  const fgExcel = loadFinishedGoodsExcel();
  const purchaseExcel = loadPurchasingExcel();
  const dektonByMaterial = loadDektonThicknessByMaterial();
  const fabricExcel = loadFabricExcel();

  console.log("[ingest] excel loaded", {
    finishedGoodsRows: fgExcel.length,
    purchasingRows: purchaseExcel.length,
    dektonMaterials: dektonByMaterial.size,
    fabricRows: fabricExcel.length,
  });

  const db = getDb();
  const mappings = await db
    .select({
      global_sku: sku_mappings.global_sku,
      category: sku_mappings.category,
      original_name: sku_mappings.original_name,
      version: sku_mappings.version,
      uom_purchase: sku_mappings.uom_purchase,
      uom_consume: sku_mappings.uom_consume,
      base_cost: sku_mappings.base_cost,
      attributes: sku_mappings.attributes,
    })
    .from(sku_mappings);

  const statsByBucket: Record<string, Stats> = {
    "Finished Good": {
      examined: 0,
      updated: 0,
      skippedVersion: 0,
      skippedNoChange: 0,
      unmatchedExcel: 0,
    },
    Metal: {
      examined: 0,
      updated: 0,
      skippedVersion: 0,
      skippedNoChange: 0,
      unmatchedExcel: 0,
    },
    Powder: {
      examined: 0,
      updated: 0,
      skippedVersion: 0,
      skippedNoChange: 0,
      unmatchedExcel: 0,
    },
    Dekton: {
      examined: 0,
      updated: 0,
      skippedVersion: 0,
      skippedNoChange: 0,
      unmatchedExcel: 0,
    },
    Fabric: {
      examined: 0,
      updated: 0,
      skippedVersion: 0,
      skippedNoChange: 0,
      unmatchedExcel: 0,
    },
  };

  let catalogUpdated = 0;

  for (const raw of mappings) {
    const mapping: MappingRow = {
      ...raw,
      attributes:
        raw.attributes && typeof raw.attributes === "object"
          ? (raw.attributes as Record<string, unknown>)
          : {},
    };
    const cat = normalizePimCategory(mapping.category);

    if (cat === "finished good") {
      const stats = statsByBucket["Finished Good"]!;
      const excel = pickFgExcel(mapping, fgExcel);
      if (!excel) {
        stats.unmatchedExcel += 1;
        continue;
      }
      await applyMappingUpdate(
        db,
        mapping,
        {
          uom_purchase: "ea",
          uom_consume: "ea",
          attributes: buildFgAttributes(excel),
        },
        stats,
        "FG",
      );
      const catChanged = await upsertFinishedGoodsCatalog(
        db,
        mapping.global_sku,
        excel,
      );
      if (catChanged) catalogUpdated += 1;
      continue;
    }

    if (cat === "metal" || cat === "powder") {
      const bucket = cat === "metal" ? "Metal" : "Powder";
      const stats = statsByBucket[bucket]!;
      const excel = pickPurchaseExcel(mapping, purchaseExcel);
      if (!excel) {
        stats.unmatchedExcel += 1;
        continue;
      }
      const unit = excel.unit?.toUpperCase() ?? null;
      await applyMappingUpdate(
        db,
        mapping,
        {
          uom_purchase: unit,
          uom_consume: unit,
          base_cost: parseMoney(excel.unitPrice),
        },
        stats,
        bucket,
      );
      continue;
    }

    if (cat === "dekton") {
      const stats = statsByBucket.Dekton!;
      const cm = dektonByMaterial.get(normalizeKey(mapping.original_name));
      if (cm == null) {
        stats.unmatchedExcel += 1;
        continue;
      }
      await applyMappingUpdate(
        db,
        mapping,
        {
          uom_purchase: "slab",
          uom_consume: "sqft",
          attributes: buildDektonAttributes(cm),
        },
        stats,
        "Dekton",
      );
      continue;
    }

    if (cat === "fabric") {
      const stats = statsByBucket.Fabric!;
      const excel = pickFabricExcel(mapping, fabricExcel);
      if (!excel) {
        stats.unmatchedExcel += 1;
        continue;
      }
      await applyMappingUpdate(
        db,
        mapping,
        {
          uom_purchase: "yd",
          uom_consume: "yd",
          attributes: buildFabricAttributes(excel),
        },
        stats,
        "Fabric",
      );
    }
  }

  console.log("[ingest] complete", {
    dryRun: DRY_RUN,
    finishedGoodsCatalogUpdated: catalogUpdated,
    byCategory: statsByBucket,
  });

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await closeDb();
  } catch {
    // ignore
  }
  process.exit(1);
});
