/**
 * Give Cabana 72 a size token that matches its actual dimensions, freeing the
 * transposed one for the plain Daybed 78.
 *
 * FIN-BRV-DYB-78X72 was authored for the 72x78 Cabana daybed — its alias reads
 * FIN-BRA-DAY-72-X-78 and its BOM points at SA-BRA-CADA-72X78-* — but the SKU
 * engine sorted the dimensions and produced 78X72. That token is the one the
 * plain Daybed 78 (genuinely 78x72) needs, so the two collide until Cabana is
 * corrected to length-first, matching the corner sofas.
 *
 * Every foreign key on sku_mappings.global_sku is ON UPDATE CASCADE, so a
 * single update carries finished_goods_catalog, product_bom, item_operations
 * and sku_aliases along with it.
 *
 * No alias row is written for the old token: it is being reassigned to a
 * different product, not deprecated, and an alias would silently redirect the
 * plain daybed to the Cabana one.
 *
 * Usage:
 *   npx tsx scripts/rename-cabana-daybed-sku.ts --dry-run
 *   npx tsx scripts/rename-cabana-daybed-sku.ts
 */
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");

const FROM = "FIN-BRV-DYB-78X72";
const TO = "FIN-BRV-DYB-72X78";

/** The Cabana 72 sub-assemblies, proving which product owns the row. */
const EXPECTED_CHILD = "SA-BRA-CADA-72X78-FRAME";

async function main(): Promise<void> {
  const db = getDb();
  console.log(dryRun ? "[dry-run] Rename Cabana 72 SKU" : "Rename Cabana 72 SKU");

  const read = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute(query);
    return (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
  };

  const existing = await read(
    sql`select global_sku, original_name from sku_mappings where global_sku in (${FROM}, ${TO})`,
  );
  const hasFrom = existing.some((row) => row.global_sku === FROM);
  const hasTo = existing.some((row) => row.global_sku === TO);

  if (hasTo && !hasFrom) {
    console.log(`  already renamed to ${TO}`);
    return;
  }
  if (!hasFrom) {
    console.error(`  ${FROM} not found`);
    process.exitCode = 1;
    return;
  }
  if (hasTo) {
    console.error(`  ${TO} already exists — cannot rename onto it`);
    process.exitCode = 1;
    return;
  }

  // Refuse to rename unless the row really is the Cabana 72.
  const children = await read(
    sql`select child_sku from product_bom where parent_sku = ${FROM}`,
  );
  const childSkus = children.map((row) => String(row.child_sku));
  if (!childSkus.includes(EXPECTED_CHILD)) {
    console.error(
      `  ${FROM} does not link to ${EXPECTED_CHILD} (found ${childSkus.join(", ") || "nothing"}) — refusing`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  confirmed ${FROM} owns ${childSkus.length} Cabana 72 links`);

  if (dryRun) {
    console.log(`  would rename ${FROM} → ${TO} (cascading)`);
    return;
  }

  await db
    .update(sku_mappings)
    .set({
      global_sku: TO,
      updated_by: "rename-cabana-daybed-sku",
      updated_at: new Date(),
    })
    .where(eq(sku_mappings.global_sku, FROM));

  const after = await read(sql`
    select
      (select count(*)::int from sku_mappings where global_sku = ${TO}) as mappings,
      (select count(*)::int from finished_goods_catalog where global_sku = ${TO}) as catalog,
      (select count(*)::int from product_bom where parent_sku = ${TO}) as bom,
      (select count(*)::int from sku_aliases where canonical_sku = ${TO}) as aliases,
      (select count(*)::int from sku_mappings where global_sku = ${FROM}) as leftover
  `);
  const row = after[0] ?? {};
  console.log(
    `  ${FROM} → ${TO}  (catalog=${row.catalog} bom=${row.bom} aliases=${row.aliases} leftover=${row.leftover})`,
  );
  if (Number(row.leftover) !== 0) {
    process.exitCode = 1;
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
