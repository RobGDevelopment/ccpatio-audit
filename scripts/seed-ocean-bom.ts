/**
 * Phase 3: author Ocean multi-level BOM + routing from the 2026-09-01 Katana pull.
 *
 * FRAME gets metals/hardware/dekton/iron wood.
 * CUSH gets foam + RM-FAB-GENERIC.
 * FG consumes 1 FRAME and 1 CUSH (seating only).
 *
 * Usage:
 *   npx tsx scripts/seed-ocean-bom.ts
 *   npx tsx scripts/seed-ocean-bom.ts --dry-run
 *
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import {
  item_operations,
  product_bom,
  sku_mappings,
} from "../src/server/db/schema";
import { KATANA_LIVE_PULL_AT } from "../src/lib/katana-bulk-materials";
import {
  buildOceanBomPlan,
  oceanFgSkuHint,
  type KatanaOperationLike,
  type KatanaRecipeLike,
} from "../src/lib/ocean-bom";
import {
  OCEAN_SA_SOURCE,
  oceanModelCodeFromSkus,
  type KatanaProductLike,
} from "../src/lib/ocean-subassemblies";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const ROOT = process.cwd();

type Dump<T> = { data?: T[] };

async function loadDump<T>(relativePath: string): Promise<T[]> {
  const filePath = path.resolve(ROOT, relativePath);
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Dump<T> | T[];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  throw new Error(`Unexpected dump shape: ${filePath}`);
}

function qtyString(value: number): string {
  return value.toFixed(4);
}

async function resolveFgSkuByModel(
  products: KatanaProductLike[],
): Promise<Map<string, string>> {
  const db = getDb();
  const finRows = await db
    .select({
      global_sku: sku_mappings.global_sku,
      original_name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(sql`${sku_mappings.global_sku} like 'FIN-OCN-%'`);

  const byExactName = new Map<string, string>();
  for (const row of finRows) {
    byExactName.set(row.original_name.trim().toUpperCase(), row.global_sku);
  }

  const map = new Map<string, string>();
  const ocean = products.filter((p) => p.category_name === "Ocean Collection");

  for (const product of ocean) {
    const skus = (product.variants ?? [])
      .map((variant) => variant.sku?.trim() ?? "")
      .filter(Boolean);
    if (skus.length === 0) continue;
    const modelCode = oceanModelCodeFromSkus(skus);
    const hint = oceanFgSkuHint(product.name);
    const exactName = byExactName.get(product.name.trim().toUpperCase());
    const prefixHit = finRows.find(
      (row) =>
        row.global_sku === hint ||
        row.global_sku.startsWith(`${hint}X`) ||
        row.global_sku.startsWith(`${hint}-`),
    );
    map.set(modelCode, exactName ?? prefixHit?.global_sku ?? hint);
  }

  return map;
}

async function ensureFinishedGoods(
  fgSkus: string[],
  nameBySku: Map<string, string>,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const unique = [...new Set(fgSkus)];
  const existing = await db
    .select({ global_sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, unique));
  const have = new Set(existing.map((row) => row.global_sku));

  const missing = unique.filter((sku) => !have.has(sku));
  if (missing.length > 0) {
    await db.insert(sku_mappings).values(
      missing.map((sku) => ({
        global_sku: sku,
        category: "Finished Good",
        item_type: "finished_good" as const,
        original_name: nameBySku.get(sku) ?? sku,
        source_file: `docs/katana_live_state @ ${KATANA_LIVE_PULL_AT}`,
        is_active: true,
        uom_consume: "ea",
        uom_purchase: "ea",
        updated_by: "ocean-bom-seed",
        updated_at: now,
      })),
    );
  }

  if (unique.length > 0) {
    await db
      .update(sku_mappings)
      .set({
        item_type: "finished_good",
        updated_by: "ocean-bom-seed",
        updated_at: now,
      })
      .where(inArray(sku_mappings.global_sku, unique));
  }
}

async function main(): Promise<void> {
  const products = await loadDump<KatanaProductLike>(OCEAN_SA_SOURCE);
  const recipes = await loadDump<KatanaRecipeLike>(
    "docs/katana_live_state/recipes.json",
  );
  const operations = await loadDump<KatanaOperationLike>(
    "docs/katana_live_state/product_operation_rows.json",
  );

  const fgSkuByModel = await resolveFgSkuByModel(products);
  const plan = buildOceanBomPlan({
    products,
    recipes,
    operations,
    fgSkuByModel,
  });

  console.log(
    dryRun
      ? `[dry-run] Ocean BOM plan (${KATANA_LIVE_PULL_AT})`
      : `Seeding Ocean BOM (${KATANA_LIVE_PULL_AT})`,
  );
  console.log(
    `  models=${plan.models.length}  bom_lines=${plan.bomLines.length}  operations=${plan.operations.length}  warnings=${plan.warnings.length}`,
  );
  for (const model of plan.models) {
    console.log(
      `  ${model.modelCode}  fg=${model.fgSkuHint}  frame=${model.frameSku}  cush=${model.cushSku ?? "—"}  canonical_variant=${model.canonicalVariantId ?? "none"}  recipe_variants=${model.recipeVariantCount}`,
    );
  }
  for (const warning of plan.warnings) {
    console.warn(`  warn: ${warning}`);
  }

  if (dryRun) {
    console.log("Sample BOM lines (first 12):");
    for (const line of plan.bomLines.slice(0, 12)) {
      console.log(
        `  ${line.parentSku} → ${line.childSku}  qty=${line.quantity} ${line.unitOfMeasure}`,
      );
    }
    return;
  }

  const nameBySku = new Map<string, string>();
  for (const model of plan.models) {
    nameBySku.set(model.fgSkuHint, model.parentName);
  }

  await ensureFinishedGoods(
    plan.models.map((model) => model.fgSkuHint),
    nameBySku,
  );

  const db = getDb();
  const now = new Date();
  const itemSkus = [...new Set(plan.operations.map((row) => row.itemSku))];
  const parentSkus = [...new Set(plan.bomLines.map((line) => line.parentSku))];

  if (parentSkus.length > 0) {
    await db
      .delete(product_bom)
      .where(inArray(product_bom.parent_sku, parentSkus));
  }

  if (itemSkus.length > 0) {
    await db
      .delete(item_operations)
      .where(inArray(item_operations.item_sku, itemSkus));
  }

  if (plan.bomLines.length > 0) {
    await db.insert(product_bom).values(
      plan.bomLines.map((line) => ({
        parent_sku: line.parentSku,
        child_sku: line.childSku,
        quantity: qtyString(line.quantity),
        scrap_factor: "1.0000",
        unit_of_measure: line.unitOfMeasure,
        updated_at: now,
      })),
    );
  }

  if (plan.operations.length > 0) {
    await db.insert(item_operations).values(
      plan.operations.map((row) => ({
        item_sku: row.itemSku,
        work_center: row.workCenter,
        sequence: row.sequence,
        setup_time_mins: null,
        run_time_mins: qtyString(row.runTimeMins),
        updated_at: now,
      })),
    );
  }

  console.log(`product_bom upserted: ${plan.bomLines.length}`);
  console.log(`item_operations inserted: ${plan.operations.length}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
