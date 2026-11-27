/**
 * Soft-patch Fanuc Gray / Lite Beige / Oil Rubbed Bronze → Gray / Beige / Bronze.
 * Never overwrites Mia-customized names.
 *
 * Usage: npx dotenv -e .env.local -- tsx scripts/soft-patch-powder-display-names.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { getDb } from "@/server/db/client";
import { ecommerce_finish_assets } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { ecommerceFinishBySku } from "@/server/ecommerce/ecommerce-32-finish-roster";
import { isStaleFinishDisplayName } from "@/server/assets/finish-assets";

const SKUS = ["PWD-FANUC-GRAY", "PWD-LITE-BEIGE", "PWD-OIL-RUB-BRONZE"] as const;

async function main() {
  const db = getDb();
  for (const sku of SKUS) {
    const def = ecommerceFinishBySku(sku);
    if (!def) continue;
    const [row] = await db
      .select()
      .from(ecommerce_finish_assets)
      .where(eq(ecommerce_finish_assets.sku, sku))
      .limit(1);
    if (!row) {
      console.log(`[skip] missing ${sku}`);
      continue;
    }
    if (!isStaleFinishDisplayName(sku, row.display_name)) {
      console.log(`[keep] ${sku} display_name=${JSON.stringify(row.display_name)}`);
      continue;
    }
    await db
      .update(ecommerce_finish_assets)
      .set({ display_name: def.displayName, updated_at: sql`now()` })
      .where(eq(ecommerce_finish_assets.sku, sku));
    console.log(`[ok] ${sku}: ${row.display_name} → ${def.displayName}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
