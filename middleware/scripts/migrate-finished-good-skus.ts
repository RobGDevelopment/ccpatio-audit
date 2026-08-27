/**
 * One-time migration: rename Finished Good SKUs from legacy dictionary tokens
 * (FIN-BRA-SWI-CHA-34) to canonical TypeScript engine format (FIN-BRV-SWV-CHA-34X34).
 *
 * Prerequisites:
 *   cd middleware
 *   npm run db:migrate          # applies 0002_sku_aliases_cascade.sql
 *
 * Usage:
 *   npx tsx scripts/migrate-finished-good-skus.ts [--dry-run] [--write-seed]
 *
 * Env: POSTGRES_URL in .env.local
 */
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateFinishedGoodSku } from "../src/lib/sku-engine";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  sku_aliases,
  sku_mappings,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const SEED_PATH = path.resolve(
  process.cwd(),
  "src",
  "generated",
  "sku-seed-data.json",
);

type SeedRow = {
  sku: string;
  original_name: string;
  category: string;
  source_file: string;
  catalog_data?: {
    msrp?: string | null;
    length?: string | null;
    depth?: string | null;
    height?: string | null;
    arm_height?: string | null;
    sit_height?: string | null;
    description?: string | null;
  };
};

type MigrationPlan = {
  oldSku: string;
  newSku: string;
  originalName: string;
};

function stripDimensionNoise(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/['"″]/g, "").trim();
}

function collectionFromName(originalName: string): string {
  const trimmed = originalName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

function buildMemo(originalName: string, description: string | null): string {
  return [description, originalName].filter(Boolean).join(" ");
}

async function loadFinishedGoods() {
  const db = getDb();
  return db
    .select({
      global_sku: sku_mappings.global_sku,
      original_name: sku_mappings.original_name,
      category: sku_mappings.category,
      msrp: finished_goods_catalog.msrp,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      description: finished_goods_catalog.description,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    )
    .where(eq(sku_mappings.category, "Finished Good"));
}

function planMigrations(
  rows: Awaited<ReturnType<typeof loadFinishedGoods>>,
): { plans: MigrationPlan[]; unchanged: number; collisions: string[] } {
  const plans: MigrationPlan[] = [];
  const targetOwners = new Map<string, string>();
  const collisions: string[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const collection = collectionFromName(row.original_name);
    const memo = buildMemo(row.original_name, row.description);
    const newSku = generateFinishedGoodSku(
      memo,
      collection,
      stripDimensionNoise(row.length),
      stripDimensionNoise(row.depth),
    );

    if (newSku === row.global_sku) {
      unchanged++;
      continue;
    }

    const owner = targetOwners.get(newSku);
    if (owner && owner !== row.global_sku) {
      collisions.push(
        `${newSku} ← ${row.global_sku} (${row.original_name}) conflicts with ${owner}`,
      );
      continue;
    }

    targetOwners.set(newSku, row.global_sku);
    plans.push({
      oldSku: row.global_sku,
      newSku,
      originalName: row.original_name,
    });
  }

  return { plans, unchanged, collisions };
}

async function applyPlans(plans: MigrationPlan[], dryRun: boolean): Promise<void> {
  const db = getDb();

  for (const plan of plans) {
    console.log(`${dryRun ? "[DRY-RUN]" : "[MIGRATE]"} ${plan.oldSku} → ${plan.newSku}`);

    if (dryRun) {
      continue;
    }

    await db.transaction(async (tx) => {
      const [targetExists] = await tx
        .select({ global_sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, plan.newSku))
        .limit(1);

      if (targetExists && targetExists.global_sku !== plan.oldSku) {
        throw new Error(
          `Collision: ${plan.newSku} already exists before renaming ${plan.oldSku}`,
        );
      }

      await tx
        .update(sku_mappings)
        .set({ global_sku: plan.newSku })
        .where(eq(sku_mappings.global_sku, plan.oldSku));

      await tx
        .insert(sku_aliases)
        .values({
          alias_sku: plan.oldSku,
          canonical_sku: plan.newSku,
          reason: "finished_good_sku_engine_v2",
        })
        .onConflictDoUpdate({
          target: sku_aliases.alias_sku,
          set: {
            canonical_sku: sql`excluded.canonical_sku`,
            reason: sql`excluded.reason`,
          },
        });
    });
  }
}

async function writeSeedFile(plans: MigrationPlan[]): Promise<number> {
  const aliasMap = new Map(plans.map((plan) => [plan.oldSku, plan.newSku]));
  const raw = await readFile(SEED_PATH, "utf8");
  const seed = JSON.parse(raw) as SeedRow[];
  let updated = 0;

  for (const row of seed) {
    if (row.category !== "Finished Good") {
      continue;
    }
    const next = aliasMap.get(row.sku);
    if (next && next !== row.sku) {
      row.sku = next;
      updated++;
    }
  }

  await writeFile(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return updated;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const writeSeed = process.argv.includes("--write-seed");

  const rows = await loadFinishedGoods();
  console.log(`Loaded ${rows.length} Finished Good rows.`);

  const { plans, unchanged, collisions } = planMigrations(rows);

  console.log(`Unchanged: ${unchanged}`);
  console.log(`To migrate: ${plans.length}`);
  if (collisions.length > 0) {
    console.log(`Collisions (${collisions.length}):`);
    for (const line of collisions) {
      console.log(`  ${line}`);
    }
  }

  if (plans.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  await applyPlans(plans, dryRun);

  if (writeSeed && !dryRun) {
    const seedUpdated = await writeSeedFile(plans);
    console.log(`Updated ${seedUpdated} Finished Good SKUs in ${SEED_PATH}`);
  }

  console.log("\n--- Migration summary ---");
  console.log(`Renamed: ${dryRun ? 0 : plans.length}`);
  console.log(`Aliases recorded: ${dryRun ? 0 : plans.length}`);
}

main()
  .catch((error: unknown) => {
    console.error("[ERROR] Fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
