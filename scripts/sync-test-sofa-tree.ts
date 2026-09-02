/**
 * One-off: push FIN-OCN-SOF-96X38 + FRAME/CUSH recipes into Katana.
 * Sets ORDER_PIPELINE_MODE=live only in this process (does not change .env.local,
 * so Woo/GHL Inngest stays gated).
 *
 *   npx tsx scripts/sync-test-sofa-tree.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.ORDER_PIPELINE_MODE = "live";

async function main(): Promise<void> {
  const { syncBOMToKatana } = await import("../src/lib/katana");
  const { closeDb } = await import("../src/server/db/client");
  try {
    const sku = "FIN-OCN-SOF-96X38";
    console.log(
      `Syncing BOM tree for ${sku} (process-local ORDER_PIPELINE_MODE=live)…`,
    );
    const result = await syncBOMToKatana(sku);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
