/**
 * Chunk C2 (`phase1-katana-bom-restore`): idempotent Hub + Katana BOM restore
 * for the 25 NEEDS_BOM Phase 1 SOW rows (22 unique Canonical SKUs).
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/restore-phase1-25-boms.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/restore-phase1-25-boms.ts --apply
 *
 * Reads tmp/phase1-25-bom-restore-plan.json for target inventory. Writes
 * run logs under gitignored tmp/. Never flips CATALOG_PUBLISH_MODE in env files;
 * --apply passes catalogMode:"live" only to syncBOMToKatana.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  fabricYards,
  foamBoardFeet,
  RM_FAB_GENERIC,
  RM_FOAM,
  RM_PWD_GENERIC,
  subAssemblySku,
} from "../../src/lib/heuristic-bom";
import {
  buildHeuristicCatalogDocument,
  HEURISTIC_POWDER_PREFERRED,
  parseFinDimensions,
  type HeuristicCatalogDocument,
  type HeuristicCatalogParent,
  type HeuristicCatalogRow,
} from "../../src/lib/heuristic-catalog-bom";
import {
  createIntervalPacer,
  ensureKatanaVariantForSku,
  findVariantById,
  findVariantBySku,
  KatanaApiError,
  setKatanaRequestPacer,
  syncBOMToKatana,
} from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const TMP = join(process.cwd(), "tmp");
const PLAN_PATH = join(TMP, "phase1-25-bom-restore-plan.json");
const ACTOR = "phase1-katana-bom-restore";
/** Order-pipe swappable powder placeholder (not a hard-coded PWD-* colorway). */
const POWDER = RM_PWD_GENERIC;

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
const dryRun = !apply;

/** 22 unique Canonical SKUs covered by the 25 NEEDS_BOM SOW rows. */
export const UNIQUE_NEEDS_BOM_SKUS = [
  "FIN-MLN-SOF-72X36",
  "FIN-MLN-SOF-84X36",
  "FIN-MLN-SOF-96X36",
  "FIN-MLN-SOF-60X62",
  "FIN-MLN-SOF-62X42",
  "FIN-BRK-BAR-TAB-36X36",
  "FIN-BRK-BAR-TAB-42X42",
  "FIN-BRK-CNT-TAB-36X36",
  "FIN-BRK-CNT-TAB-42X42",
  "FIN-BRK-DIN-TAB-36X36",
  "FIN-BRK-DIN-TAB-42X42",
  "FIN-WFT-DIN-BCH-72X22",
  "FIN-WFT-DIN-BCH-96X22",
  "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-BCH-42X18",
  "FIN-WFT-DIN-CHA-18X18",
  "FIN-WFT-FLY-BST-17X21",
  "FIN-TAY-BST-19X23",
  "FIN-TAY-BST-24X23",
  "FIN-CAB-MIS-17X17",
  "FIN-CAB-MIS-23X23",
  "FIN-CAB-MIS-12X24",
] as const;

/** All 25 SOW rows (shared canonicals appear once per variation/alias). */
export const NEEDS_BOM_SOW_ROWS: ReadonlyArray<{
  sku: string;
  variation: string;
  wooAlias: string | null;
}> = [
  { sku: "FIN-MLN-SOF-72X36", variation: "one-sided-72", wooAlias: null },
  { sku: "FIN-MLN-SOF-84X36", variation: "one-sided-84", wooAlias: null },
  { sku: "FIN-MLN-SOF-96X36", variation: "one-sided-96", wooAlias: null },
  { sku: "FIN-MLN-SOF-60X62", variation: "double-sided-60x62", wooAlias: null },
  { sku: "FIN-MLN-SOF-62X42", variation: "t-shaped-62x42", wooAlias: null },
  { sku: "FIN-BRK-BAR-TAB-36X36", variation: "star-bar-36", wooAlias: null },
  { sku: "FIN-BRK-BAR-TAB-42X42", variation: "star-bar-42", wooAlias: null },
  { sku: "FIN-BRK-CNT-TAB-36X36", variation: "star-counter-36", wooAlias: null },
  { sku: "FIN-BRK-CNT-TAB-42X42", variation: "star-counter-42", wooAlias: null },
  { sku: "FIN-BRK-DIN-TAB-36X36", variation: "star-dining-36", wooAlias: null },
  { sku: "FIN-BRK-DIN-TAB-42X42", variation: "star-dining-42", wooAlias: null },
  { sku: "FIN-WFT-DIN-BCH-72X22", variation: "dining-bench-72", wooAlias: null },
  { sku: "FIN-WFT-DIN-BCH-96X22", variation: "dining-bench-96", wooAlias: null },
  { sku: "FIN-WFT-FLY-BST-18X18", variation: "fly-bar", wooAlias: "FIN-WFT-FLY-BST-18X18-BAR" },
  { sku: "FIN-WFT-FLY-BST-18X18", variation: "fly-counter", wooAlias: "FIN-WFT-FLY-BST-18X18-CNT" },
  { sku: "FIN-WFT-BCH-42X18", variation: "fly-bench", wooAlias: null },
  { sku: "FIN-WFT-DIN-CHA-18X18", variation: "fly-chair", wooAlias: null },
  { sku: "FIN-WFT-FLY-BST-17X21", variation: "halfback-bar", wooAlias: "FIN-WFT-FLY-BST-17X21-BAR" },
  { sku: "FIN-WFT-FLY-BST-17X21", variation: "halfback-counter", wooAlias: "FIN-WFT-FLY-BST-17X21-CNT" },
  { sku: "FIN-TAY-BST-19X23", variation: "taylor-bar", wooAlias: "FIN-TAY-BST-19X23-BAR" },
  { sku: "FIN-TAY-BST-19X23", variation: "taylor-counter", wooAlias: "FIN-TAY-BST-19X23-CNT" },
  { sku: "FIN-TAY-BST-24X23", variation: "taylor-arms-bar", wooAlias: null },
  { sku: "FIN-CAB-MIS-17X17", variation: "pillow-17", wooAlias: null },
  { sku: "FIN-CAB-MIS-23X23", variation: "pillow-23", wooAlias: null },
  { sku: "FIN-CAB-MIS-12X24", variation: "pillow-lumbar-12x24", wooAlias: null },
];

export const TEMPLATE_BY_SKU: Record<string, string> = {
  "FIN-MLN-SOF-72X36": "FIN-MLN-CLB-CHA-32X36",
  "FIN-MLN-SOF-84X36": "FIN-MLN-CLB-CHA-32X36",
  "FIN-MLN-SOF-96X36": "FIN-MLN-CLB-CHA-32X36",
  "FIN-MLN-SOF-60X62": "FIN-MLN-CLB-CHA-32X36",
  "FIN-MLN-SOF-62X42": "FIN-MLN-CLB-CHA-32X36",
  "FIN-BRK-BAR-TAB-36X36": "FIN-BRV-COF-TAB-36X36",
  "FIN-BRK-BAR-TAB-42X42": "FIN-BRV-COF-TAB-36X36",
  "FIN-BRK-CNT-TAB-36X36": "FIN-BRV-COF-TAB-36X36",
  "FIN-BRK-CNT-TAB-42X42": "FIN-BRV-COF-TAB-36X36",
  "FIN-BRK-DIN-TAB-36X36": "FIN-BRV-COF-TAB-36X36",
  "FIN-BRK-DIN-TAB-42X42": "FIN-BRV-COF-TAB-36X36",
  "FIN-WFT-DIN-BCH-72X22": "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-DIN-BCH-96X22": "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-FLY-BST-18X18": "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-BCH-42X18": "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-DIN-CHA-18X18": "FIN-WFT-FLY-BST-18X18",
  "FIN-WFT-FLY-BST-17X21": "FIN-WFT-FLY-BST-18X18",
  "FIN-TAY-BST-19X23": "FIN-TAY-DIN-CHA-24X23",
  "FIN-TAY-BST-24X23": "FIN-TAY-DIN-CHA-24X23",
  "FIN-CAB-MIS-17X17": "FIN-CAB-MIS-10X10",
  "FIN-CAB-MIS-23X23": "FIN-CAB-MIS-10X10",
  "FIN-CAB-MIS-12X24": "FIN-CAB-MIS-10X10",
};

export type BomKind = "seating" | "table" | "pillow";

export function bomKindForSku(sku: string): BomKind {
  const u = sku.trim().toUpperCase();
  if (u.startsWith("FIN-CAB-MIS-") && u !== "FIN-CAB-MIS-10X10") return "pillow";
  if (/-TAB-/.test(u) || u.includes("-TAB")) return "table";
  return "seating";
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function categoryForSku(sku: string): string {
  if (sku.startsWith("FIN-MLN-")) return "Milan Collection";
  if (sku.startsWith("FIN-BRK-")) return "Brooklyn Collection";
  if (sku.startsWith("FIN-WFT-")) return "Waterfall Collection";
  if (sku.startsWith("FIN-TAY-")) return "Taylor Collection";
  if (sku.startsWith("FIN-CAB-")) return "Cabana Collection";
  return "Finished Good";
}

function row(
  ingredientSku: string,
  quantity: number,
  uom: string,
  notes: string,
): HeuristicCatalogRow {
  return {
    ingredientSku,
    quantity: round4(quantity),
    uom,
    notes,
    cutList: [],
  };
}

/**
 * Pillow-only BOM: FG → CUSH → (RM-FAB-GENERIC + RM-RAW-FOAM).
 * ZERO FRM-*, metal tubing, or powder-coat rows so pillow orders only bind fabric.
 */
export function buildPillowOnlyDocument(finSku: string): HeuristicCatalogDocument {
  const sku = finSku.trim().toUpperCase();
  const dims = parseFinDimensions(sku);
  if (!dims) {
    throw new Error(`Pillow ${sku} missing WxD dimensions in SKU`);
  }
  const cushSku = subAssemblySku(sku, "CUSH");
  // Pillow scrap: fabricYards(... pillow=true) already adds +1 yd; ×1.1 scrap.
  const fabric = round4(fabricYards(dims.widthIn, dims.depthIn, 0, true) * 1.1);
  // Insert: reuse cushion foam formula at half thickness (2in polyfill/dacron insert).
  const foam = round4(foamBoardFeet(dims.widthIn, dims.depthIn) * 0.5);

  const cushRows: HeuristicCatalogRow[] = [
    row(
      RM_FAB_GENERIC,
      fabric,
      "yd",
      `pillow fabricYards(${dims.widthIn}x${dims.depthIn}) × 1.1 — swap FAB-* at order time`,
    ),
    row(
      RM_FOAM,
      foam,
      "boardft",
      `pillow insert foamBoardFeet(${dims.widthIn}x${dims.depthIn}) × 0.5`,
    ),
  ];

  return {
    status: "ready",
    skipReason: null,
    finSku: sku,
    name: sku,
    category: categoryForSku(sku),
    family: "seating",
    dimSource: dims.dimSource,
    widthIn: dims.widthIn,
    depthIn: dims.depthIn,
    heightIn: 4,
    tubeNetFt: 0,
    frameSku: null,
    cushionSku: cushSku,
    powderSku: POWDER,
    parents: [
      { role: "cushion", sku: cushSku, rows: cushRows },
      {
        role: "finished_good",
        sku,
        rows: [row(cushSku, 1, "ea", "FG consumes one pillow cushion — no frame")],
      },
    ],
  };
}

/** Remap any hard-coded PWD-* colorway to RM-PWD-GENERIC so powder_coat can bind. */
function withSwappablePowder(doc: HeuristicCatalogDocument): HeuristicCatalogDocument {
  const parents = doc.parents.map((parent) => ({
    ...parent,
    rows: parent.rows.map((line) =>
      line.ingredientSku.startsWith("PWD-")
        ? {
            ...line,
            ingredientSku: POWDER,
            notes: line.notes.replace(/PWD-[A-Z0-9-]+/g, POWDER),
          }
        : line,
    ),
  }));
  return { ...doc, powderSku: POWDER, parents };
}

export function buildRestoreDocument(finSku: string): HeuristicCatalogDocument {
  const kind = bomKindForSku(finSku);
  if (kind === "pillow") return buildPillowOnlyDocument(finSku);

  const built = buildHeuristicCatalogDocument(
    {
      finSku,
      name: finSku,
      category: categoryForSku(finSku),
    },
    { powderSku: POWDER },
  );
  if (built.status !== "ready") {
    throw new Error(`${finSku} heuristic build skipped: ${built.skipReason}`);
  }

  // Tables must never carry fabric; strip if any slipped in.
  if (kind === "table") {
    const parents = built.parents
      .filter((p) => p.role !== "cushion")
      .map((p) => ({
        ...p,
        rows: p.rows.filter((r) => r.ingredientSku !== RM_FAB_GENERIC),
      }));
    const fg = parents.find((p) => p.role === "finished_good");
    if (fg) {
      fg.rows = fg.rows.filter(
        (r) => !r.ingredientSku.endsWith("-CUSH") && r.ingredientSku !== RM_FAB_GENERIC,
      );
    }
    return withSwappablePowder({ ...built, cushionSku: null, parents });
  }

  return withSwappablePowder(built);
}

/** Assert pillow docs never include frame/metal/powder. */
export function assertPillowSafe(doc: HeuristicCatalogDocument): void {
  const allSkus = doc.parents.flatMap((p) => [
    p.sku,
    ...p.rows.map((r) => r.ingredientSku),
  ]);
  for (const s of allSkus) {
    const u = s.toUpperCase();
    if (
      u.endsWith("-FRAME") ||
      u.startsWith("FRM-") ||
      u.startsWith("PWD-") ||
      u.includes("TUBING") ||
      u.includes("FLATBAR") ||
      u.includes("METAL-CAP")
    ) {
      throw new Error(`Pillow BOM leaked frame/powder component: ${s}`);
    }
  }
}

/** Assert table docs never include fabric. */
export function assertTableSafe(doc: HeuristicCatalogDocument): void {
  const allSkus = doc.parents.flatMap((p) => p.rows.map((r) => r.ingredientSku));
  if (allSkus.includes(RM_FAB_GENERIC)) {
    throw new Error(`Table BOM leaked RM-FAB-GENERIC on ${doc.finSku}`);
  }
  if (doc.parents.some((p) => p.role === "cushion")) {
    throw new Error(`Table BOM has cushion parent on ${doc.finSku}`);
  }
}

export type PlanFile = {
  targetCount: number;
  targets: Array<{ sku: string; templateSku: string; group: string }>;
};

export function loadRestorePlan(path = PLAN_PATH): PlanFile {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run enable-phase1-hub-data.ts first.`);
  }
  const plan = JSON.parse(readFileSync(path, "utf8")) as PlanFile;
  if (plan.targetCount !== 25 || plan.targets.length !== 25) {
    throw new Error(`Plan must list 25 targets, got ${plan.targets.length}`);
  }
  return plan;
}

export function uniqueSkusFromPlan(plan: PlanFile): string[] {
  return [...new Set(plan.targets.map((t) => t.sku.trim().toUpperCase()))].sort();
}

async function ensureHubSku(
  sku: string,
  itemType: "finished_good" | "sub_assembly" | "raw_material",
  uom: string,
  variantId: number | null,
  category: string,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({
      sku: sku_mappings.global_sku,
      variantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!existing) {
    await db.insert(sku_mappings).values({
      global_sku: sku,
      category,
      item_type: itemType,
      original_name: sku,
      source_file: ACTOR,
      uom_consume: uom,
      uom_purchase: uom,
      katana_variant_id: variantId,
      is_active: true,
    });
    return;
  }

  if (variantId != null && existing.variantId == null) {
    await db
      .update(sku_mappings)
      .set({ katana_variant_id: variantId, updated_at: new Date() })
      .where(eq(sku_mappings.global_sku, sku));
  }
}

/**
 * Clear Hub katana_* ids that point at soft-deleted / missing Katana variants,
 * then ensure each ingredient exists live so syncBOMToKatana can POST recipes.
 */
export async function healStaleIngredientVariants(
  skus: readonly string[],
): Promise<Array<{ sku: string; action: string; variantId: number | null }>> {
  const db = getDb();
  const out: Array<{ sku: string; action: string; variantId: number | null }> = [];
  for (const raw of skus) {
    const sku = raw.trim().toUpperCase();
    const [mapping] = await db
      .select({
        sku: sku_mappings.global_sku,
        vid: sku_mappings.katana_variant_id,
        mid: sku_mappings.katana_material_id,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);
    if (!mapping) {
      out.push({ sku, action: "missing_hub", variantId: null });
      continue;
    }

    let live =
      mapping.vid != null ? await findVariantById(mapping.vid) : null;
    if (!live) {
      live = await findVariantBySku(sku);
    }

    if (mapping.vid != null && !live) {
      await db
        .update(sku_mappings)
        .set({
          katana_variant_id: null,
          katana_material_id: null,
          updated_at: new Date(),
        })
        .where(eq(sku_mappings.global_sku, sku));
      console.log(`  heal cleared stale katana ids for ${sku} (was variant ${mapping.vid})`);
    } else if (live && mapping.vid !== live.id) {
      await db
        .update(sku_mappings)
        .set({
          katana_variant_id: live.id,
          katana_material_id: live.material_id ?? null,
          updated_at: new Date(),
        })
        .where(eq(sku_mappings.global_sku, sku));
      console.log(`  heal rebound ${sku} → variant ${live.id}`);
    }

    const ensured = await ensureKatanaVariantForSku(sku);
    if (!ensured.ok) {
      out.push({ sku, action: `ensure_failed:${ensured.error}`, variantId: null });
      continue;
    }
    out.push({
      sku,
      action: ensured.action,
      variantId: ensured.variantId,
    });
  }
  return out;
}

function collectIngredientSkus(docs: HeuristicCatalogDocument[]): string[] {
  const set = new Set<string>();
  for (const doc of docs) {
    for (const parent of doc.parents) {
      set.add(parent.sku);
      for (const line of parent.rows) set.add(line.ingredientSku);
    }
  }
  return [...set].sort();
}

async function replaceHubBom(doc: HeuristicCatalogDocument): Promise<void> {
  const db = getDb();
  const parents = doc.parents.map((p) => p.sku);

  for (const parent of doc.parents) {
    if (parent.role === "finished_good") {
      await ensureHubSku(parent.sku, "finished_good", "ea", null, doc.category);
    } else {
      await ensureHubSku(parent.sku, "sub_assembly", "ea", null, doc.category);
    }
    for (const line of parent.rows) {
      if (line.ingredientSku.startsWith("ASM-") || line.ingredientSku.startsWith("SA-")) {
        continue;
      }
      await ensureHubSku(
        line.ingredientSku,
        "raw_material",
        line.uom,
        null,
        "Raw Material",
      );
    }
  }

  const liveRows = doc.parents.flatMap((parent) =>
    parent.rows.map((line) => ({
      parent_sku: parent.sku,
      child_sku: line.ingredientSku,
      quantity: line.quantity.toFixed(4),
      scrap_factor: "1.0000",
      unit_of_measure: line.uom,
      notes: `${line.notes} [${ACTOR}]`,
      cut_list: line.cutList,
    })),
  );
  const draftRows = liveRows.map((line) => ({
    ...line,
    status: "factory_approved" as const,
    source: "heuristic" as const,
    reviewed_by: ACTOR,
    reviewed_at: new Date(),
  }));

  await db.transaction(async (tx) => {
    for (const parent of parents) {
      await tx.delete(product_bom).where(eq(product_bom.parent_sku, parent));
      await tx.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, parent));
    }
    if (liveRows.length > 0) await tx.insert(product_bom).values(liveRows);
    if (draftRows.length > 0) await tx.insert(product_bom_draft).values(draftRows);
  });
}

function summarize(doc: HeuristicCatalogDocument): Record<string, unknown> {
  return {
    finSku: doc.finSku,
    kind: bomKindForSku(doc.finSku),
    template: TEMPLATE_BY_SKU[doc.finSku] ?? null,
    widthIn: doc.widthIn,
    depthIn: doc.depthIn,
    heightIn: doc.heightIn,
    frameSku: doc.frameSku,
    cushionSku: doc.cushionSku,
    parents: doc.parents.map((p: HeuristicCatalogParent) => ({
      role: p.role,
      sku: p.sku,
      rows: p.rows.map((r) => ({
        sku: r.ingredientSku,
        qty: r.quantity,
        uom: r.uom,
      })),
    })),
  };
}

export type RestoreResult = {
  sku: string;
  kind: BomKind;
  hubAction: "would_write" | "wrote" | "skipped";
  katanaAction: "would_sync" | "synced" | "skipped" | "failed";
  katanaVariantId: number | null;
  message: string;
};

async function restoreOne(sku: string): Promise<RestoreResult> {
  const kind = bomKindForSku(sku);
  const doc = buildRestoreDocument(sku);
  if (kind === "pillow") assertPillowSafe(doc);
  if (kind === "table") assertTableSafe(doc);

  if (dryRun) {
    return {
      sku,
      kind,
      hubAction: "would_write",
      katanaAction: "would_sync",
      katanaVariantId: null,
      message: `dry-run ${doc.parents.length} parents / ${doc.parents.reduce((n, p) => n + p.rows.length, 0)} edges`,
    };
  }

  await replaceHubBom(doc);

  const sync = await syncBOMToKatana(sku, {
    catalogMode: "live",
    idempotencyKey: `${ACTOR}:${sku}`,
  });
  if (!sync.ok) {
    return {
      sku,
      kind,
      hubAction: "wrote",
      katanaAction: "failed",
      katanaVariantId: null,
      message: sync.error,
    };
  }

  const db = getDb();
  const [row] = await db
    .select({ vid: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  return {
    sku,
    kind,
    hubAction: "wrote",
    katanaAction: "synced",
    katanaVariantId: row?.vid ?? sync.productVariantId ?? null,
    message: sync.message,
  };
}

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  console.log(dryRun ? "Dry-run. No Hub/Katana writes." : "APPLY. Hub replace + Katana syncBOMToKatana(live).");

  if (NEEDS_BOM_SOW_ROWS.length !== 25) {
    throw new Error(`NEEDS_BOM_SOW_ROWS must be 25, got ${NEEDS_BOM_SOW_ROWS.length}`);
  }
  if (UNIQUE_NEEDS_BOM_SKUS.length !== 22) {
    throw new Error(`UNIQUE_NEEDS_BOM_SKUS must be 22, got ${UNIQUE_NEEDS_BOM_SKUS.length}`);
  }

  const plan = loadRestorePlan();
  const unique = uniqueSkusFromPlan(plan);
  console.log(`plan targets=${plan.targets.length} unique=${unique.length}`);

  const docs = unique.map((sku) => {
    const doc = buildRestoreDocument(sku);
    if (bomKindForSku(sku) === "pillow") assertPillowSafe(doc);
    if (bomKindForSku(sku) === "table") assertTableSafe(doc);
    return doc;
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "apply",
    actor: ACTOR,
    sowRows: NEEDS_BOM_SOW_ROWS.length,
    uniqueSkus: unique.length,
    documents: docs.map(summarize),
  };
  const manifestPath = join(TMP, "phase1-25-bom-restore-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${manifestPath}`);

  if (dryRun) {
    console.log(`powder placeholder=${POWDER} (heuristic preferred was ${HEURISTIC_POWDER_PREFERRED})`);
    for (const doc of docs) {
      const kind = bomKindForSku(doc.finSku);
      console.log(
        `  ${doc.finSku} kind=${kind} parents=${doc.parents.length} dims=${doc.widthIn}x${doc.depthIn}`,
      );
    }
    console.log("Dry-run complete.");
    return;
  }

  setKatanaRequestPacer(createIntervalPacer(1300));

  // Hub BOMs first (so heal sees final ingredient set), then heal stale RMs, then Katana sync.
  console.log("→ Writing Hub product_bom trees");
  for (const doc of docs) {
    await replaceHubBom(doc);
    console.log(`  hub wrote ${doc.finSku}`);
  }

  const ingredients = collectIngredientSkus(docs);
  console.log(`→ Healing ${ingredients.length} ingredient / parent Katana variants`);
  const healReport = await healStaleIngredientVariants(ingredients);
  writeFileSync(
    join(TMP, "phase1-25-bom-restore-heal-report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), healReport }, null, 2),
  );
  const healFails = healReport.filter((h) => h.action.startsWith("ensure_failed"));
  if (healFails.length > 0) {
    throw new Error(
      `Ingredient heal failed for ${healFails.length} SKU(s):\n${healFails.map((h) => `${h.sku}: ${h.action}`).join("\n")}`,
    );
  }

  const results: RestoreResult[] = [];
  const failures: string[] = [];
  for (const sku of unique) {
    console.log(`→ Katana sync ${sku}`);
    try {
      const sync = await syncBOMToKatana(sku, {
        catalogMode: "live",
        idempotencyKey: `${ACTOR}:${sku}`,
      });
      const db = getDb();
      const [row] = await db
        .select({ vid: sku_mappings.katana_variant_id })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, sku))
        .limit(1);
      const result: RestoreResult = sync.ok
        ? {
            sku,
            kind: bomKindForSku(sku),
            hubAction: "wrote",
            katanaAction: "synced",
            katanaVariantId: row?.vid ?? sync.productVariantId ?? null,
            message: sync.message,
          }
        : {
            sku,
            kind: bomKindForSku(sku),
            hubAction: "wrote",
            katanaAction: "failed",
            katanaVariantId: null,
            message: sync.error,
          };
      results.push(result);
      console.log(
        `  hub=${result.hubAction} katana=${result.katanaAction} vid=${result.katanaVariantId ?? "null"} ${result.message}`,
      );
      if (result.katanaAction === "failed") {
        failures.push(`${sku}: ${result.message}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${sku}: ${message}`);
      failures.push(`${sku}: ${message}`);
      results.push({
        sku,
        kind: bomKindForSku(sku),
        hubAction: "skipped",
        katanaAction: "failed",
        katanaVariantId: null,
        message,
      });
    }
  }

  const reportPath = join(TMP, "phase1-25-bom-restore-apply-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: "apply",
        results,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${reportPath}`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} SKU(s) failed.\n${failures.join("\n")}`);
  }
  console.log(`Apply complete. ${results.length} unique SKUs restored.`);
}

const isMain =
  process.argv[1]?.replace(/\\/g, "/").includes("restore-phase1-25-boms");

if (isMain) {
  main()
    .catch((error: unknown) => {
      if (error instanceof KatanaApiError && error.details != null) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
