/**
 * List FIN logistics rows still missing weight because height could not be
 * resolved. Rows with no footprint are omitted.
 *
 *   npx dotenv -e .env.local -- tsx scripts/admin/list-unknown-height-skus.ts
 */
import { loadEnvConfig } from "@next/env";
import { and, isNull, sql } from "drizzle-orm";
import { estimateHeuristicLogistics } from "../../src/lib/heuristic-logistics";
import { closeDb, getDb } from "../../src/server/db/client";
import { logistics_profiles } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const db = getDb();
  try {
    const rows = await db
      .select({ variantSku: logistics_profiles.variant_sku })
      .from(logistics_profiles)
      .where(
        and(
          isNull(logistics_profiles.weight_lb),
          sql`${logistics_profiles.variant_sku} LIKE 'FIN-%'`,
        ),
      );

    const unknown: string[] = [];
    for (const row of rows) {
      const result = estimateHeuristicLogistics(row.variantSku);
      if (result.status === "skipped" && result.reason === "unknown_height") {
        unknown.push(result.sku);
      }
    }
    unknown.sort();
    console.log(`null-weight FIN rows: ${rows.length}`);
    console.log(`unknown_height: ${unknown.length}`);
    for (const sku of unknown) console.log(sku);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
