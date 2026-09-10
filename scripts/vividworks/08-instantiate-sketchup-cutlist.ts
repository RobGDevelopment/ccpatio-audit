/**
 * Instantiate SketchUp walker JSON → product_bom_draft (sketchup_geometry).
 * Never writes live product_bom.
 *
 * Usage:
 *   npx tsx scripts/vividworks/08-instantiate-sketchup-cutlist.ts --live
 *   npx tsx scripts/vividworks/08-instantiate-sketchup-cutlist.ts path/to/export.cutlist.json --live
 *   npx tsx scripts/vividworks/08-instantiate-sketchup-cutlist.ts --waterfall --live
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  item_operations_draft,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  bravadaClubChairFixtureWalker,
  critiqueCutlistPlan,
  instantiateBravadaClubChair,
  instantiateWaterfallDiningTable,
  type InstantiatedPlan,
  type WalkerExport,
} from "../../src/lib/sketchup-cutlist";
import { parseDaeWeldment } from "../diagnostics/parse-dae-weldment";

loadEnvConfig(process.cwd());

const LIVE = process.argv.includes("--live");
const WATERFALL = process.argv.includes("--waterfall");

function loadWalker(): WalkerExport {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (arg) {
    const full = path.resolve(arg);
    if (full.toLowerCase().endsWith(".dae")) {
      return parseDaeWeldment(full).walker;
    }
    return JSON.parse(fs.readFileSync(full, "utf8")) as WalkerExport;
  }

  if (WATERFALL) {
    const dae = path.join(
      process.cwd(),
      "docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae",
    );
    const cutlist = path.join(
      process.cwd(),
      "scripts/diagnostics/cutlist-exports/FIN-WFT-DIN-TAB-72X28.cutlist.json",
    );
    if (fs.existsSync(dae)) return parseDaeWeldment(dae).walker;
    if (fs.existsSync(cutlist)) {
      return JSON.parse(fs.readFileSync(cutlist, "utf8")) as WalkerExport;
    }
    throw new Error("Waterfall DAE / cutlist JSON not found");
  }

  const fixturePath = path.join(
    process.cwd(),
    "scripts/diagnostics/cutlist-exports/bravada-club-chair.cutlist.json",
  );
  if (fs.existsSync(fixturePath)) {
    return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as WalkerExport;
  }
  return bravadaClubChairFixtureWalker();
}

function buildPlan(walker: WalkerExport): InstantiatedPlan {
  if (WATERFALL || /WFT|WATERFALL/i.test(walker.productHint ?? "")) {
    return instantiateWaterfallDiningTable(walker);
  }
  return instantiateBravadaClubChair(walker);
}

async function ensureHubSkus(plan: InstantiatedPlan): Promise<void> {
  const db = getDb();
  for (const hub of plan.hubSkus) {
    const [existing] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, hub.globalSku))
      .limit(1);
    if (existing) continue;
    await db.insert(sku_mappings).values({
      global_sku: hub.globalSku,
      category: hub.category,
      item_type: hub.itemType,
      original_name: hub.originalName,
      source_file: "sketchup_cutlist_instantiate",
      is_active: true,
    });
    console.log(`  minted ${hub.globalSku}`);
  }
}

async function writeDrafts(plan: InstantiatedPlan): Promise<number> {
  const db = getDb();
  let upserts = 0;
  for (const line of plan.lines) {
    const [child] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, line.childSku))
      .limit(1);
    if (!child) {
      console.warn(`  skip missing child SKU ${line.childSku}`);
      continue;
    }

    const notesPayload = line.cutList.length
      ? `${line.notes}\n${JSON.stringify({ cut_list: line.cutList })}`
      : line.notes;

    await db
      .insert(product_bom_draft)
      .values({
        parent_sku: line.parentSku,
        child_sku: line.childSku,
        quantity: String(line.quantity),
        scrap_factor: String(line.scrapFactor),
        unit_of_measure: line.unitOfMeasure,
        status: "draft_pending_review",
        source: "sketchup_geometry",
        notes: notesPayload,
      })
      .onConflictDoUpdate({
        target: [product_bom_draft.parent_sku, product_bom_draft.child_sku],
        set: {
          quantity: String(line.quantity),
          scrap_factor: String(line.scrapFactor),
          unit_of_measure: line.unitOfMeasure,
          status: "draft_pending_review",
          source: "sketchup_geometry",
          notes: notesPayload,
          updated_at: new Date(),
        },
      });
    upserts += 1;
  }

  const weldSkus = [plan.seatSku, plan.armSku, plan.backSku].filter(
    (s): s is string => Boolean(s),
  );
  for (const sku of weldSkus) {
    const [exists] = await db
      .select({ id: item_operations_draft.id })
      .from(item_operations_draft)
      .where(eq(item_operations_draft.item_sku, sku))
      .limit(1);
    if (exists) continue;
    await db.insert(item_operations_draft).values({
      item_sku: sku,
      work_center: "Building & Welding",
      sequence: 20,
      run_time_mins: "15",
      status: "draft_pending_review",
      source: "sketchup_geometry",
      notes: "From SketchUp cut-list instantiate",
    });
  }

  return upserts;
}

async function main(): Promise<void> {
  const walker = loadWalker();
  const plan = buildPlan(walker);
  const critic = critiqueCutlistPlan({
    plan,
    walker,
    imagePaths: [
      path.join(process.cwd(), "docs/BOM_Examples/BravadaSample.jpeg"),
    ].filter((p) => fs.existsSync(p)),
  });

  console.log(`FIN ${plan.finSku}`);
  console.log(`  lines=${plan.lines.length} flags=${plan.flags.length}`);
  console.log(
    `  critic okForDraft=${critic.okForDraft} findings=${critic.findings.length}`,
  );
  for (const f of critic.findings) {
    console.log(`    [${f.severity}] ${f.code}: ${f.message}`);
  }
  for (const line of plan.lines) {
    console.log(
      `  ${line.parentSku} → ${line.childSku}  qty=${line.quantity} ${line.unitOfMeasure}`,
    );
  }

  if (!LIVE) {
    console.log("\nDry-run only. Pass --live to write product_bom_draft.");
    return;
  }

  if (!critic.okForDraft) {
    throw new Error("Critic reported errors — refusing --live write");
  }

  await ensureHubSkus(plan);
  const n = await writeDrafts(plan);
  console.log(
    `\nUpserted ${n} product_bom_draft rows (source=sketchup_geometry).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
