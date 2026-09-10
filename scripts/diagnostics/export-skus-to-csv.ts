/**
 * Export finished-good hub SKUs to Phase1_and_2_SKUs.csv for 3D / VividWorks mapping.
 *
 * Usage (repo root):
 *   npx tsx scripts/diagnostics/export-skus-to-csv.ts
 *
 * Env: POSTGRES_URL (via .env.local)
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function exportSkus() {
  const db = getDb();
  const skus = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .innerJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(eq(sku_mappings.item_type, "finished_good"));

  let csv = "Collection Prefix,Official SKU,Original Product Name\n";

  skus.forEach((row) => {
    const collection = row.sku.split("-")[1] || "UNKNOWN";
    csv += `${collection},${row.sku},${csvCell(row.name)}\n`;
  });

  fs.writeFileSync("Phase1_and_2_SKUs.csv", csv);
  console.log(`✅ Exported ${skus.length} SKUs to Phase1_and_2_SKUs.csv`);
}

exportSkus()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
