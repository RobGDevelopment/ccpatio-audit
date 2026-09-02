/**
 * Read-only audit of the Bravada/Brooklyn PIM tree against the Katana pull.
 *
 * Recomputes the sub-assembly set the seeder would generate today and diffs it
 * against what is actually in Supabase, so rows left behind by an earlier run
 * under a since-renamed SKU show up instead of quietly serving stale cut-lists.
 *
 * Usage: npx tsx scripts/audit-collection-bom.ts
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import {
  buildSubAssemblies,
  COLLECTIONS,
  COLLECTION_SOURCE,
  productsInCollection,
  type CollectionKey,
  type KatanaProductLike,
} from "../src/lib/collection-catalog";

loadEnvConfig(process.cwd());

const TARGETS: CollectionKey[] = ["bravada", "brooklyn"];

async function main(): Promise<void> {
  const parsed = JSON.parse(
    await readFile(path.resolve(process.cwd(), COLLECTION_SOURCE), "utf8"),
  ) as { data?: KatanaProductLike[] } | KatanaProductLike[];
  const products = Array.isArray(parsed) ? parsed : (parsed.data ?? []);

  const expected = new Set<string>();
  for (const key of TARGETS) {
    const config = COLLECTIONS[key];
    for (const row of buildSubAssemblies(
      productsInCollection(products, config),
      config,
    )) {
      expected.add(row.globalSku);
    }
  }

  const db = getDb();
  const read = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute(query);
    return (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
  };

  const actual = await read(sql`
    select global_sku, is_active from sku_mappings
    where global_sku like 'SA-BRA-%' or global_sku like 'SA-BRO-%'
    order by global_sku
  `);
  const activeSkus = actual
    .filter((row) => row.is_active === true)
    .map((row) => String(row.global_sku));
  const retiredSkus = actual
    .filter((row) => row.is_active !== true)
    .map((row) => String(row.global_sku));

  console.log(`expected sub-assemblies:      ${expected.size}`);
  console.log(`active sub-assemblies in PIM: ${activeSkus.length}`);
  console.log(`retired sub-assemblies:       ${retiredSkus.length}`);

  // Only an active row that the seeder no longer generates is a problem; a
  // retired one is the expected end state for a product pulled from Katana.
  const orphaned = activeSkus.filter((sku) => !expected.has(sku));
  console.log(`\nactive sub-assemblies no longer generated: ${orphaned.length}`);
  for (const sku of orphaned) {
    const lines = await read(sql`
      select count(*)::int as n from product_bom where parent_sku = ${sku}
    `);
    const children = await read(sql`
      select count(*)::int as n from product_bom where child_sku = ${sku}
    `);
    console.log(
      `  ${sku.padEnd(32)} cut-list rows=${lines[0]?.n ?? 0}  parents=${children[0]?.n ?? 0}`,
    );
  }

  const stillCarrying = await read(sql`
    select pb.parent_sku, count(*)::int as n
    from product_bom pb
    join sku_mappings sm on sm.global_sku = pb.parent_sku
    where sm.is_active = false
    group by pb.parent_sku
  `);
  console.log(
    `\nretired or superseded parents still carrying BOM rows: ${stillCarrying.length}`,
  );
  for (const row of stillCarrying) {
    console.log(`  ${String(row.parent_sku).padEnd(32)} ${row.n} rows`);
  }

  const missing = [...expected].filter((sku) => !activeSkus.includes(sku));
  console.log(`\nexpected but absent from PIM: ${missing.length}`);
  for (const sku of missing) console.log(`  ${sku}`);

  console.log("\nhanded Bravada frames — cut-list rows and last write:");
  const handed = await read(sql`
    select sm.global_sku,
           (select count(*)::int from product_bom pb where pb.parent_sku = sm.global_sku) as lines,
           (select max(pb.updated_at) from product_bom pb where pb.parent_sku = sm.global_sku) as last_write
    from sku_mappings sm
    where sm.global_sku ~ '^SA-BRA-.*-(LS|RS)-FRAME$'
    order by sm.global_sku
  `);
  for (const row of handed) {
    console.log(
      `  ${String(row.global_sku).padEnd(32)} ${String(row.lines).padStart(2)} lines  ${row.last_write ?? "—"}`,
    );
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
