/**
 * One-shot: retire PWD-BEIGE into sku_aliases → PWD-LITE-BEIGE.
 * Soft-disable duplicate finish asset; never wipe Mia photoshoot / customized names.
 *
 * Usage: npx dotenv -e .env.local -- tsx scripts/retire-pwd-beige-alias.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { getDb } from "@/server/db/client";
import { ecommerce_finish_assets, sku_aliases, sku_mappings } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { ECOMMERCE_FINISH_DISABLED_SENTINEL } from "@/server/ecommerce/ecommerce-32-finish-roster";

const ALIAS = "PWD-BEIGE";
const CANONICAL = "PWD-LITE-BEIGE";

async function main() {
  const db = getDb();

  // Ensure canonical exists in sku_mappings before alias FK insert.
  const [canonMap] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, CANONICAL))
    .limit(1);
  if (!canonMap) {
    console.warn(`[skip] ${CANONICAL} missing from sku_mappings — alias not written`);
  } else {
    await db
      .insert(sku_aliases)
      .values({
        alias_sku: ALIAS,
        canonical_sku: CANONICAL,
        reason: "ecommerce-32-finish-roster:Beige (PWD-BEIGE retired)",
      })
      .onConflictDoUpdate({
        target: sku_aliases.alias_sku,
        set: {
          canonical_sku: CANONICAL,
          reason: "ecommerce-32-finish-roster:Beige (PWD-BEIGE retired)",
        },
      });
    console.log(`[ok] sku_aliases ${ALIAS} → ${CANONICAL}`);
  }

  // Soft-disable duplicate finish row if present (never delete).
  const [beige] = await db
    .select()
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.sku, ALIAS))
    .limit(1);
  if (beige) {
    await db
      .update(ecommerce_finish_assets)
      .set({
        uploaded_by: ECOMMERCE_FINISH_DISABLED_SENTINEL,
        updated_at: sql`now()`,
      })
      .where(eq(ecommerce_finish_assets.sku, ALIAS));
    console.log(`[ok] soft-disabled ecommerce_finish_assets ${ALIAS}`);
  } else {
    console.log(`[skip] no ecommerce_finish_assets row for ${ALIAS}`);
  }

  // Scrub Rue Coastal bogus 27" repeats if still present.
  await db.execute(sql`
    UPDATE ecommerce_finish_assets
    SET
      pattern_repeat_w_in = NULL,
      pattern_repeat_h_in = NULL,
      sample_width_in = COALESCE(sample_width_in, 8),
      sample_height_in = COALESCE(sample_height_in, 8),
      updated_at = now()
    WHERE upper(sku) = 'FAB-RUE-COS'
      AND (
        pattern_repeat_w_in::numeric = 27
        OR pattern_repeat_h_in::numeric = 27
      )
  `);
  console.log("[ok] Rue Coastal 27-repeat scrub attempted");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
