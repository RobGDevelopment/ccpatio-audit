/**
 * Phase 2: seed Ocean FRAME / CUSH sub-assemblies into sku_mappings.
 * One FRAME per Ocean product; CUSH only for seating (sofa/chair/chaise/ottoman).
 * Does not POST to Katana.
 *
 * Usage:
 *   npx tsx scripts/seed-ocean-subassemblies.ts
 *   npx tsx scripts/seed-ocean-subassemblies.ts --dry-run
 *
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";
import { KATANA_LIVE_PULL_AT } from "../src/lib/katana-bulk-materials";
import {
  buildOceanSubAssemblies,
  OCEAN_SA_SOURCE,
  type KatanaProductLike,
} from "../src/lib/ocean-subassemblies";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const SOURCE_FILE = `${OCEAN_SA_SOURCE} @ ${KATANA_LIVE_PULL_AT}`;
const PRODUCTS_PATH = path.resolve(process.cwd(), OCEAN_SA_SOURCE);

type ProductsDump = {
  data?: KatanaProductLike[];
};

async function loadOceanProducts(): Promise<KatanaProductLike[]> {
  const raw = await readFile(PRODUCTS_PATH, "utf8");
  const parsed = JSON.parse(raw) as ProductsDump | KatanaProductLike[];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  throw new Error(`Unexpected products dump shape: ${PRODUCTS_PATH}`);
}

async function main(): Promise<void> {
  const products = await loadOceanProducts();
  const rows = buildOceanSubAssemblies(products);
  const frames = rows.filter((row) => row.role === "frame");
  const cushions = rows.filter((row) => row.role === "cushion");

  console.log(
    dryRun
      ? `[dry-run] Would upsert ${rows.length} Ocean sub-assemblies`
      : `Upserting ${rows.length} Ocean sub-assemblies`,
  );
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`  FRAME: ${frames.length}  CUSH: ${cushions.length}`);

  if (dryRun) {
    for (const row of rows) {
      console.log(
        `  ${row.globalSku}  ${row.role}  parent=${row.parentName}  katana_product=${row.katanaParentProductId}`,
      );
    }
    return;
  }

  const db = getDb();
  const now = new Date();

  const mappingRows = rows.map((row) => ({
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
      factory_model: row.modelCode,
      katana_parent_product_id: row.katanaParentProductId,
      parent_name: row.parentName,
      variant_count: row.variantCount,
    },
    updated_by: "ocean-sa-seed",
    updated_at: now,
  }));

  const mappingResult = await db
    .insert(sku_mappings)
    .values(mappingRows)
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
    .returning({
      global_sku: sku_mappings.global_sku,
      item_type: sku_mappings.item_type,
    });

  console.log(`sku_mappings upserted: ${mappingResult.length}`);
  for (const row of mappingResult) {
    console.log(`  ${row.global_sku}  ${row.item_type}`);
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
