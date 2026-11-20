/**
 * Ensure Asset Studio buckets + non-destructively seed ecommerce_finish_assets
 * (24 FAB fabrics as placeholder_lowres, PWD powders, DEC Dekton).
 * Never overwrites a non-empty swatch_thumb_url / texture_2k_url or quality_status.
 *
 * Usage: npx tsx scripts/ops/seed-ecommerce-finish-assets.ts
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";

loadEnvConfig(path.resolve(process.cwd()));

async function main(): Promise<void> {
  const { ensureAssetStudioBuckets } = await import("../../src/server/assets/ensure-buckets");
  const { seedEcommerceFinishAssets, listFinishAssets } = await import(
    "../../src/server/assets/finish-assets"
  );
  const { closeDb } = await import("../../src/server/db/client");

  try {
    const { buckets } = await ensureAssetStudioBuckets();
    console.log("buckets:", buckets);

    const result = await seedEcommerceFinishAssets();
    console.log("seed:", result);

    const rows = await listFinishAssets();
    const summary: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.finish_category}/${r.quality_status}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
    console.log("registry:", { total: rows.length, ...summary });
    console.log("OK: finish assets seeded.");
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
