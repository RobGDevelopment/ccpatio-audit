/**
 * Phase 2: author Bravada + Brooklyn FRAME/CUSH sub-assemblies and the nested
 * BOM / routing in Supabase. PIM only — this never calls Katana.
 *
 * Products with no Katana recipe (all of Brooklyn, most of Bravada) still get
 * FG -> FRAME (+ CUSH when seating) so the factory can fill the cut-list later.
 *
 * Usage:
 *   npx tsx scripts/seed-remaining-collections.ts --dry-run
 *   npx tsx scripts/seed-remaining-collections.ts
 *   npx tsx scripts/seed-remaining-collections.ts --only bravada
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
  buildSubAssemblies,
  COLLECTIONS,
  COLLECTION_SOURCE,
  productsInCollection,
  type CollectionConfig,
  type CollectionKey,
  type KatanaProductLike,
  type SubAssemblySeed,
} from "../src/lib/collection-catalog";
import {
  buildCollectionBomPlan,
  type CollectionBomPlan,
  type KatanaOperationLike,
  type KatanaRecipeLike,
} from "../src/lib/collection-bom";
import { resolveFinishedGoodsByModel } from "../src/lib/collection-fg-match";

loadEnvConfig(process.cwd());

const ROOT = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const SOURCE_FILE = `${COLLECTION_SOURCE} @ ${KATANA_LIVE_PULL_AT}`;

const TARGETS: CollectionKey[] = (() => {
  const index = process.argv.indexOf("--only");
  if (index === -1) return ["bravada", "brooklyn"];
  const value = process.argv[index + 1]?.trim().toLowerCase();
  if (value === "bravada" || value === "brooklyn") return [value];
  throw new Error("--only must be bravada or brooklyn");
})();

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

async function loadFgCandidates(config: CollectionConfig) {
  return getDb()
    .select({
      globalSku: sku_mappings.global_sku,
      originalName: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(sql`${sku_mappings.global_sku} like ${`${config.finPrefix}%`}`);
}

async function upsertSubAssemblies(rows: SubAssemblySeed[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  const now = new Date();

  const result = await db
    .insert(sku_mappings)
    .values(
      rows.map((row) => ({
        global_sku: row.globalSku,
        category: "Sub-Assembly",
        item_type: "sub_assembly" as const,
        original_name:
          row.role === "frame"
            ? `${row.parentName} Frame`
            : `${row.parentName} Cushion`,
        source_file: SOURCE_FILE,
        is_active: true,
        uom_purchase: "ea",
        uom_consume: "ea",
        attributes: {
          role: row.role,
          collection: row.collection,
          factory_model: row.modelCode,
          katana_parent_product_id: row.katanaParentProductId,
          parent_name: row.parentName,
          variant_count: row.variantCount,
        },
        updated_by: "remaining-collections-seed",
        updated_at: now,
      })),
    )
    .onConflictDoUpdate({
      target: sku_mappings.global_sku,
      set: {
        category: sql`excluded.category`,
        item_type: sql`excluded.item_type`,
        original_name: sql`excluded.original_name`,
        source_file: sql`excluded.source_file`,
        uom_purchase: sql`excluded.uom_purchase`,
        uom_consume: sql`excluded.uom_consume`,
        attributes: sql`excluded.attributes`,
        updated_by: sql`excluded.updated_by`,
        updated_at: sql`excluded.updated_at`,
      },
    })
    .returning({ global_sku: sku_mappings.global_sku });

  return result.length;
}

async function writePlan(
  plan: CollectionBomPlan,
  ownedSkus: string[],
): Promise<void> {
  const db = getDb();
  const now = new Date();

  // Clear every parent this collection owns, not just the ones receiving lines
  // this run. A sub-assembly whose cut-list legitimately became empty — an RS
  // frame after the LS/RS split, say — would otherwise keep the rows a previous
  // run gave it and silently serve a mirrored cut-list.
  const parentSkus = [
    ...new Set([...ownedSkus, ...plan.bomLines.map((line) => line.parentSku)]),
  ];
  const itemSkus = [
    ...new Set([...ownedSkus, ...plan.operations.map((row) => row.itemSku)]),
  ];

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
}

/**
 * Retire sub-assemblies this collection no longer generates. Retiring a product
 * in Katana drops it from the pull, which would otherwise leave its FRAME/CUSH
 * rows behind holding a cut-list nothing points at.
 */
async function retireStaleSubAssemblies(
  config: CollectionConfig,
  generated: string[],
): Promise<string[]> {
  const db = getDb();
  const live = new Set(generated);

  const existing = await db
    .select({ globalSku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(sql`${sku_mappings.global_sku} like ${`SA-${config.skuPrefix}-%`}`);

  const stale = existing
    .map((row) => row.globalSku)
    .filter((sku) => !live.has(sku));
  if (stale.length === 0) return [];

  await db.delete(product_bom).where(inArray(product_bom.parent_sku, stale));
  await db.delete(product_bom).where(inArray(product_bom.child_sku, stale));
  await db.delete(item_operations).where(inArray(item_operations.item_sku, stale));
  await db
    .update(sku_mappings)
    .set({
      is_active: false,
      updated_by: "remaining-collections-seed",
      updated_at: new Date(),
    })
    .where(inArray(sku_mappings.global_sku, stale));

  return stale;
}

/** Parents must be finished_good so Katana syncs them as producible products. */
async function markFinishedGoods(fgSkus: string[]): Promise<void> {
  if (fgSkus.length === 0) return;
  await getDb()
    .update(sku_mappings)
    .set({
      item_type: "finished_good",
      updated_by: "remaining-collections-seed",
      updated_at: new Date(),
    })
    .where(inArray(sku_mappings.global_sku, [...new Set(fgSkus)]));
}

async function runCollection(
  config: CollectionConfig,
  products: KatanaProductLike[],
  recipes: KatanaRecipeLike[],
  operations: KatanaOperationLike[],
): Promise<void> {
  const scoped = productsInCollection(products, config);
  const subAssemblies = buildSubAssemblies(scoped, config);
  const candidates = await loadFgCandidates(config);
  const fg = resolveFinishedGoodsByModel({ products, config, candidates });

  const plan = buildCollectionBomPlan({
    products,
    recipes,
    operations,
    config,
    fgSkuByModel: fg.fgSkuByModel,
  });

  const frames = subAssemblies.filter((row) => row.role === "frame").length;
  const cushions = subAssemblies.filter((row) => row.role === "cushion").length;
  const withRecipes = plan.models.filter(
    (model) => model.canonicalVariantId != null,
  ).length;

  console.log(`=== ${config.label} (${config.katanaCategory})`);
  console.log(
    `  products=${scoped.length}  sub_assemblies=${subAssemblies.length} (FRAME ${frames} / CUSH ${cushions})`,
  );
  console.log(
    `  fg_candidates=${candidates.length}  fg_matched=${fg.matched.length}  fg_unmatched=${fg.unmatched.length}`,
  );
  console.log(
    `  models_with_katana_recipe=${withRecipes}  bom_lines=${plan.bomLines.length}  operations=${plan.operations.length}`,
  );

  for (const model of plan.models) {
    console.log(
      `  ${model.modelCode.padEnd(20)} fg=${(model.fgSku ?? "—").padEnd(26)} frame=${model.frameSku}  cush=${model.cushSku ?? "—"}  recipe_variants=${model.recipeVariantCount}`,
    );
  }

  for (const row of fg.unmatched) {
    console.log(`  unlinked: ${row.modelCode} (${row.productName})`);
  }
  for (const warning of [...fg.warnings, ...plan.warnings]) {
    console.warn(`  warn: ${warning}`);
  }

  if (dryRun) {
    console.log("  sample BOM lines:");
    for (const line of plan.bomLines.slice(0, 10)) {
      console.log(
        `    ${line.parentSku} → ${line.childSku}  qty=${line.quantity} ${line.unitOfMeasure}`,
      );
    }
    return;
  }

  const upserted = await upsertSubAssemblies(subAssemblies);
  await markFinishedGoods(
    plan.models
      .map((model) => model.fgSku)
      .filter((sku): sku is string => sku !== null),
  );
  await writePlan(plan, [
    ...subAssemblies.map((row) => row.globalSku),
    ...plan.models
      .map((model) => model.fgSku)
      .filter((sku): sku is string => sku !== null),
  ]);

  const retired = await retireStaleSubAssemblies(
    config,
    subAssemblies.map((row) => row.globalSku),
  );

  console.log(
    `  wrote: sku_mappings=${upserted}  product_bom=${plan.bomLines.length}  item_operations=${plan.operations.length}`,
  );
  for (const sku of retired) {
    console.log(`  retired: ${sku} (no longer in the Katana pull)`);
  }
}

async function main(): Promise<void> {
  const products = await loadDump<KatanaProductLike>(COLLECTION_SOURCE);
  const recipes = await loadDump<KatanaRecipeLike>(
    "docs/katana_live_state/recipes.json",
  );
  const operations = await loadDump<KatanaOperationLike>(
    "docs/katana_live_state/product_operation_rows.json",
  );

  console.log(
    dryRun
      ? `[dry-run] Phase 2 seed (${KATANA_LIVE_PULL_AT}) — no writes`
      : `Phase 2 seed (${KATANA_LIVE_PULL_AT})`,
  );
  console.log(`Source: ${SOURCE_FILE}`);

  for (const key of TARGETS) {
    await runCollection(COLLECTIONS[key], products, recipes, operations);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
