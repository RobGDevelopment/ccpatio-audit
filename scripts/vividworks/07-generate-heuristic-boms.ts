/**
 * Upsert Phase 1+2 FIN-* hub shells, then write volumetric FRAME/CUSH drafts.
 *
 * Default --dry-run. --live writes product_bom_draft / item_operations_draft
 * only. Never touches live product_bom (Katana explode path).
 *
 * Usage:
 *   npx tsx scripts/vividworks/07-generate-heuristic-boms.ts
 *   npx tsx scripts/vividworks/07-generate-heuristic-boms.ts --live
 *   npx tsx scripts/vividworks/07-generate-heuristic-boms.ts --live --limit 10
 *
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  RM_PWD_GENERIC,
  buildHeuristicPlan,
  type HeuristicSlots,
} from "../../src/lib/heuristic-bom";
import { KATANA_BULK_MATERIALS } from "../../src/lib/katana-bulk-materials";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  raw_materials_catalog,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const HANDOFF_DIR = path.resolve(process.cwd(), "docs/Vividworks/Handoff");
const PHASE1_CSV = path.join(HANDOFF_DIR, "vividworks_phase1_products.csv");
const PHASE2_CSV = path.join(HANDOFF_DIR, "vividworks_phase2_products.csv");
const RULES_PATH = path.join(HANDOFF_DIR, "vividworks_configuration_rules.json");
const AUDIT_PATH = path.join(HANDOFF_DIR, "sow_unmatched_audit.json");

const LIVE = process.argv.includes("--live");
const DRY_RUN = process.argv.includes("--dry-run") || !LIVE;

function readArg(name: string): string | null {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) {
    const value = process.argv[idx + 1];
    if (value && !value.startsWith("--")) return value;
  }
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function readLimit(): number | null {
  const raw = readArg("limit");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

type PhaseRow = {
  phase: 1 | 2;
  sowName: string;
  canonicalSku: string;
  collection: string;
  length: string;
  depth: string;
  height: string;
  msrp: string;
  weight: string;
};

type RulesFile = {
  products?: Array<{
    sowName?: string;
    canonicalSku?: string;
    slots?: {
      upholstery?: { enabled?: boolean };
      frameFinish?: { enabled?: boolean };
      tableTop?: { enabled?: boolean };
      pillow?: { enabled?: boolean };
    };
  }>;
};

function readPhaseCsv(filePath: string, phase: 1 | 2): PhaseRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Run 04-generate-complete-sow-datapack.ts first.`,
    );
  }
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows
    .map((row) => ({
      phase,
      sowName: cellText(row["SOW Product Name"]),
      canonicalSku: cellText(row["Canonical SKU"]).toUpperCase(),
      collection: cellText(row["Collection"]) || "Finished Good",
      length: cellText(row["Length"]),
      depth: cellText(row["Depth"]),
      height: cellText(row["Height"]),
      msrp: cellText(row["MSRP"]),
      weight: cellText(row["Base Weight"]),
    }))
    .filter((row) => row.canonicalSku.startsWith("FIN-"));
}

function loadSlots(): Map<string, HeuristicSlots> {
  const map = new Map<string, HeuristicSlots>();
  if (!fs.existsSync(RULES_PATH)) return map;
  const parsed = JSON.parse(fs.readFileSync(RULES_PATH, "utf8")) as RulesFile;
  for (const product of parsed.products ?? []) {
    const sku = cellText(product.canonicalSku).toUpperCase();
    if (!sku) continue;
    map.set(sku, {
      fabric: Boolean(product.slots?.upholstery?.enabled),
      powder: Boolean(product.slots?.frameFinish?.enabled),
      dekton: Boolean(product.slots?.tableTop?.enabled),
      pillow: Boolean(product.slots?.pillow?.enabled),
    });
  }
  return map;
}

function loadUnmatchedNames(): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(AUDIT_PATH)) return names;
  const parsed = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8")) as {
    unmatched?: Array<{ sowName?: string }>;
  };
  for (const row of parsed.unmatched ?? []) {
    const name = cellText(row.sowName);
    if (name) names.add(name);
  }
  return names;
}

async function ensurePlaceholderMaterials(): Promise<number> {
  const db = getDb();
  const placeholders = [
    ...KATANA_BULK_MATERIALS.map((row) => ({
      sku: row.globalSku,
      name: row.name,
      category: row.category,
      uom: row.uomConsume,
    })),
    {
      sku: RM_PWD_GENERIC,
      name: "Powder coat (generic placeholder)",
      category: "Powder",
      uom: "lb",
    },
  ];

  let upserted = 0;
  for (const row of placeholders) {
    await db
      .insert(sku_mappings)
      .values({
        global_sku: row.sku,
        category: row.category,
        item_type: "raw_material",
        original_name: row.name,
        source_file: "heuristic_placeholders",
        is_active: true,
        uom_consume: row.uom,
        uom_purchase: row.uom,
      })
      .onConflictDoNothing({ target: sku_mappings.global_sku });
    await db
      .insert(raw_materials_catalog)
      .values({
        sku: row.sku,
        name: row.name,
        category: row.category,
        unit_of_measure: row.uom,
      })
      .onConflictDoNothing({ target: raw_materials_catalog.sku });
    upserted += 1;
  }
  return upserted;
}

async function upsertHubSku(row: {
  globalSku: string;
  itemType: "finished_good" | "sub_assembly";
  originalName: string;
  category: string;
  sourceFile: string;
  msrp?: string;
  length?: string;
  depth?: string;
  height?: string;
  weight?: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(sku_mappings)
    .values({
      global_sku: row.globalSku,
      category: row.category,
      item_type: row.itemType,
      original_name: row.originalName,
      source_file: row.sourceFile,
      is_active: true,
      uom_consume: "ea",
      uom_purchase: "ea",
    })
    .onConflictDoUpdate({
      target: sku_mappings.global_sku,
      set: {
        original_name: sql`excluded.original_name`,
        category: sql`excluded.category`,
        source_file: sql`excluded.source_file`,
        item_type: sql`excluded.item_type`,
      },
    });

  if (row.itemType !== "finished_good") return;

  await db
    .insert(finished_goods_catalog)
    .values({
      global_sku: row.globalSku,
      msrp: row.msrp || null,
      length: row.length || null,
      depth: row.depth || null,
      height: row.height || null,
      weight: row.weight || null,
      description: row.originalName,
    })
    .onConflictDoUpdate({
      target: finished_goods_catalog.global_sku,
      set: {
        msrp: sql`excluded.msrp`,
        length: sql`excluded.length`,
        depth: sql`excluded.depth`,
        height: sql`excluded.height`,
        weight: sql`excluded.weight`,
        description: sql`excluded.description`,
        updated_at: sql`now()`,
      },
    });
}

async function main(): Promise<void> {
  const limit = readLimit();
  const unmatched = loadUnmatchedNames();
  const slotsBySku = loadSlots();
  const combined = [...readPhaseCsv(PHASE1_CSV, 1), ...readPhaseCsv(PHASE2_CSV, 2)];
  const unique = new Map<string, PhaseRow>();
  for (const row of combined) {
    if (!unique.has(row.canonicalSku)) unique.set(row.canonicalSku, row);
  }
  const rows = [...unique.values()].slice(0, limit ?? unique.size);

  console.log("[heuristic] Phase 1+2 hub + draft BOMs", {
    csvRows: combined.length,
    uniqueSkus: unique.size,
    seeding: rows.length,
    mode: DRY_RUN ? "dry-run" : "LIVE",
    unmatchedSowLines: unmatched.size,
  });

  const stats = {
    hubFg: 0,
    hubSa: 0,
    planned: 0,
    skippedLiveBom: 0,
    skippedFamily: 0,
    skippedUnmatched: 0,
    draftLines: 0,
    draftOps: 0,
  };

  if (!DRY_RUN) {
    if (!process.env.POSTGRES_URL?.trim()) {
      throw new Error("POSTGRES_URL is not set.");
    }
    await ensurePlaceholderMaterials();
  }

  const db = DRY_RUN ? null : getDb();
  const liveParents = new Set<string>();
  if (db && rows.length > 0) {
    const live = await db
      .selectDistinct({ parent: product_bom.parent_sku })
      .from(product_bom)
      .where(
        inArray(
          product_bom.parent_sku,
          rows.map((row) => row.canonicalSku),
        ),
      );
    for (const row of live) liveParents.add(row.parent);
  }

  for (const row of rows) {
    if (unmatched.has(row.sowName)) {
      stats.skippedUnmatched += 1;
      console.log(`[heuristic] SKIP unmatched SOW "${row.sowName}"`);
      continue;
    }

    const slots = slotsBySku.get(row.canonicalSku) ?? {
      fabric: true,
      powder: true,
      dekton: false,
      pillow: false,
    };
    const plan = buildHeuristicPlan({
      sowName: row.sowName,
      canonicalSku: row.canonicalSku,
      collection: row.collection,
      length: row.length,
      depth: row.depth,
      height: row.height,
      slots,
    });

    if (!DRY_RUN) {
      for (const hub of plan.hubSkus) {
        await upsertHubSku({
          ...hub,
          sourceFile:
            hub.itemType === "finished_good"
              ? `vividworks_phase${row.phase}`
              : "heuristic_subassembly",
          msrp: row.msrp,
          length: row.length,
          depth: row.depth,
          height: row.height,
          weight: row.weight,
        });
        if (hub.itemType === "finished_good") stats.hubFg += 1;
        else stats.hubSa += 1;
      }
    } else {
      stats.hubFg += 1;
      stats.hubSa += plan.hubSkus.filter((h) => h.itemType === "sub_assembly")
        .length;
    }

    if (plan.family === "skip" || plan.lines.length === 0) {
      stats.skippedFamily += 1;
      console.log(
        `[heuristic] SKIP ${row.canonicalSku} (${plan.skippedReason ?? plan.family})`,
      );
      continue;
    }

    if (liveParents.has(row.canonicalSku)) {
      stats.skippedLiveBom += 1;
      console.log(
        `[heuristic] SKIP ${row.canonicalSku} live product_bom already exists`,
      );
      continue;
    }

    stats.planned += 1;
    stats.draftLines += plan.lines.length;
    stats.draftOps += plan.operations.length;

    if (DRY_RUN) {
      console.log(
        `[heuristic] DRY-RUN ${row.canonicalSku} ${plan.family} lines=${plan.lines.length} ops=${plan.operations.length}`,
      );
      continue;
    }

    const now = new Date();
    for (const bomLine of plan.lines) {
      const existing = await db!
        .select({
          id: product_bom_draft.id,
          status: product_bom_draft.status,
        })
        .from(product_bom_draft)
        .where(
          and(
            eq(product_bom_draft.parent_sku, bomLine.parentSku),
            eq(product_bom_draft.child_sku, bomLine.childSku),
          ),
        )
        .limit(1);
      if (existing[0]?.status && existing[0].status !== "draft_pending_review") {
        continue;
      }
      if (existing[0]) {
        await db!
          .update(product_bom_draft)
          .set({
            quantity: bomLine.quantity.toFixed(4),
            scrap_factor: bomLine.scrapFactor.toFixed(4),
            unit_of_measure: bomLine.unitOfMeasure,
            notes: bomLine.notes,
            updated_at: now,
          })
          .where(eq(product_bom_draft.id, existing[0].id));
      } else {
        await db!.insert(product_bom_draft).values({
          parent_sku: bomLine.parentSku,
          child_sku: bomLine.childSku,
          quantity: bomLine.quantity.toFixed(4),
          scrap_factor: bomLine.scrapFactor.toFixed(4),
          unit_of_measure: bomLine.unitOfMeasure,
          status: "draft_pending_review",
          source: "heuristic",
          notes: bomLine.notes,
          updated_at: now,
        });
      }
    }

    for (const op of plan.operations) {
      const existing = await db!
        .select({ id: item_operations_draft.id, status: item_operations_draft.status })
        .from(item_operations_draft)
        .where(
          and(
            eq(item_operations_draft.item_sku, op.itemSku),
            eq(item_operations_draft.work_center, op.workCenter),
            eq(item_operations_draft.sequence, op.sequence),
          ),
        )
        .limit(1);
      if (existing[0]?.status && existing[0].status !== "draft_pending_review") {
        continue;
      }
      if (existing[0]) {
        await db!
          .update(item_operations_draft)
          .set({
            run_time_mins: String(op.runTimeMins),
            updated_at: now,
          })
          .where(eq(item_operations_draft.id, existing[0].id));
      } else {
        await db!.insert(item_operations_draft).values({
          item_sku: op.itemSku,
          work_center: op.workCenter,
          sequence: op.sequence,
          run_time_mins: String(op.runTimeMins),
          status: "draft_pending_review",
          source: "heuristic",
          updated_at: now,
        });
      }
    }

    console.log(
      `[heuristic] DRAFT ${row.canonicalSku} ${plan.family} lines=${plan.lines.length}`,
    );

    try {
      const { runSecondaryExtract } = await import(
        "@/lib/secondary-extraction"
      );
      const est = await runSecondaryExtract(row.canonicalSku);
      console.log(
        `[heuristic] estimates ${row.canonicalSku} weight=${est.estWeightLbs} dim=${est.estDimWeightLbs} labor=${est.estLaborMinutes} ops=${est.opsUpdated}`,
      );
    } catch (estError: unknown) {
      console.warn(
        `[heuristic] estimate skip ${row.canonicalSku}:`,
        estError instanceof Error ? estError.message : estError,
      );
    }
  }

  console.log("[heuristic] summary", stats);
}

main()
  .catch((error: unknown) => {
    console.error("[heuristic] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
