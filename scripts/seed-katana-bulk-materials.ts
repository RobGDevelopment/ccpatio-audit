/**
 * Phase 1: seed the 13 Katana bulk materials into sku_mappings +
 * raw_materials_catalog, writing katana_variant_id / katana_material_id
 * from the 2026-09-01 live dump (does not POST to Katana).
 *
 * Usage:
 *   npx tsx scripts/seed-katana-bulk-materials.ts
 *   npx tsx scripts/seed-katana-bulk-materials.ts --dry-run
 *
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import {
  raw_materials_catalog,
  sku_mappings,
} from "../src/server/db/schema";
import {
  KATANA_BULK_MATERIALS,
  KATANA_IDENTITY_SOURCE,
  KATANA_LIVE_PULL_AT,
} from "../src/lib/katana-bulk-materials";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const SOURCE_FILE = `${KATANA_IDENTITY_SOURCE} @ ${KATANA_LIVE_PULL_AT}`;

async function main(): Promise<void> {
  console.log(
    dryRun
      ? `[dry-run] Would upsert ${KATANA_BULK_MATERIALS.length} bulk materials`
      : `Upserting ${KATANA_BULK_MATERIALS.length} Katana bulk materials`,
  );
  console.log(`Source: ${SOURCE_FILE}`);

  if (dryRun) {
    for (const row of KATANA_BULK_MATERIALS) {
      console.log(
        `  ${row.globalSku}  material=${row.katanaMaterialId} variant=${row.katanaVariantId}  ${row.name}`,
      );
    }
    return;
  }

  const db = getDb();
  const now = new Date();

  const mappingRows = KATANA_BULK_MATERIALS.map((row) => ({
    global_sku: row.globalSku,
    category: row.category,
    item_type: "raw_material" as const,
    original_name: row.name,
    source_file: SOURCE_FILE,
    is_active: true,
    uom_purchase: row.uomConsume,
    uom_consume: row.uomConsume,
    base_cost: row.baseCost,
    katana_variant_id: row.katanaVariantId,
    katana_material_id: row.katanaMaterialId,
    attributes: {
      katana_uom: row.katanaUom,
      katana_notes: row.notes,
      factory_placeholder: true,
    },
    updated_by: "katana-identity-seed",
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
        base_cost: sql`excluded.base_cost`,
        katana_variant_id: sql`excluded.katana_variant_id`,
        katana_material_id: sql`excluded.katana_material_id`,
        attributes: sql`excluded.attributes`,
        updated_by: sql`excluded.updated_by`,
        updated_at: sql`excluded.updated_at`,
      },
    })
    .returning({
      global_sku: sku_mappings.global_sku,
      katana_variant_id: sku_mappings.katana_variant_id,
    });

  const catalogRows = KATANA_BULK_MATERIALS.map((row) => ({
    sku: row.globalSku,
    name: row.name,
    category: row.category,
    unit_of_measure: row.uomConsume,
    cost_per_unit: row.baseCost,
    updated_at: now,
  }));

  const catalogResult = await db
    .insert(raw_materials_catalog)
    .values(catalogRows)
    .onConflictDoUpdate({
      target: raw_materials_catalog.sku,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        unit_of_measure: sql`excluded.unit_of_measure`,
        cost_per_unit: sql`excluded.cost_per_unit`,
        updated_at: sql`excluded.updated_at`,
      },
    })
    .returning({ sku: raw_materials_catalog.sku });

  console.log(`sku_mappings upserted: ${mappingResult.length}`);
  console.log(`raw_materials_catalog upserted: ${catalogResult.length}`);
  for (const row of mappingResult) {
    console.log(`  ${row.global_sku}  katana_variant_id=${row.katana_variant_id}`);
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
