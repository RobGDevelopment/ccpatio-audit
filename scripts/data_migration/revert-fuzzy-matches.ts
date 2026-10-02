/**
 * Revert the 15 image writes from the fuzzy Woo sync.
 *
 * The hub dictionary is sku_mappings. There is no syncToEcom column;
 * the e-commerce flag is sku_mappings.sync_to_woo. Images live on
 * finished_goods_catalog.image_url, not on the dictionary row.
 *
 * sync_to_woo is not how those 15 were selected: that flag is unused.
 * The 15 rows are the audit entries with imageWrite === "updated".
 *
 *   npm run migrate:revert-fuzzy
 *   npm run migrate:revert-fuzzy -- --dry-run
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import { finished_goods_catalog, sku_mappings } from "../../src/server/db/schema";

const AUDIT_PATH = join(process.cwd(), "scripts/data_migration/woo-variants-map.json");

type AuditProduct = {
  name?: string;
  matchedGlobalSku?: string | null;
  imageSrc?: string | null;
  imageWrite?: string;
};

function updatedSkus(products: AuditProduct[]): string[] {
  const skus = products
    .filter((product) => product.imageWrite === "updated" && product.matchedGlobalSku)
    .map((product) => String(product.matchedGlobalSku).trim().toUpperCase());
  return [...new Set(skus)];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as { products?: AuditProduct[] };
  const skus = updatedSkus(audit.products ?? []);
  if (skus.length !== 15) {
    throw new Error(
      `Expected 15 updated image rows in woo-variants-map.json, found ${skus.length}.`,
    );
  }

  const db = getDb();
  let cleared = 0;
  let alreadyClear = 0;
  let leftInPlace = 0;

  for (const sku of skus) {
    const [catalog] = await db
      .select({ imageUrl: finished_goods_catalog.image_url })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, sku))
      .limit(1);
    const current = catalog?.imageUrl?.trim() ?? "";
    const wooSrc = (audit.products ?? []).find(
      (product) =>
        product.imageWrite === "updated" &&
        String(product.matchedGlobalSku ?? "").trim().toUpperCase() === sku,
    )?.imageSrc?.trim() ?? "";

    if (current && wooSrc && current !== wooSrc) {
      leftInPlace += 1;
      console.log(`[kept] ${sku} image is no longer the Woo URL from the audit`);
    } else if (!current) {
      alreadyClear += 1;
      console.log(`[clear] ${sku} image_url already null`);
    } else if (!dryRun) {
      await db
        .update(finished_goods_catalog)
        .set({
          image_url: null,
          updated_by: "migrate:revert-fuzzy",
          updated_at: new Date(),
        })
        .where(eq(finished_goods_catalog.global_sku, sku));
      cleared += 1;
      console.log(`[reverted] ${sku}`);
    } else {
      cleared += 1;
      console.log(`[dry-run] ${sku}`);
    }

    if (!dryRun) {
      await db
        .update(sku_mappings)
        .set({
          sync_to_woo: false,
          updated_by: "migrate:revert-fuzzy",
          updated_at: new Date(),
        })
        .where(eq(sku_mappings.global_sku, sku));
    }
  }

  console.log(JSON.stringify({ dryRun, skus: skus.length, cleared, alreadyClear, leftInPlace }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
