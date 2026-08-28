/**
 * Upsert sku_mappings from generated sku-seed-data.json.
 * Also upserts finished_goods_catalog when catalog_data is present.
 * Never overwrites katana_* / woo_* / ghl_* / is_active / saved image_url.
 *
 * Usage: npx tsx scripts/seed-sku-mappings.ts
 */
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

type CatalogData = {
  msrp?: string | null;
  length?: string | null;
  depth?: string | null;
  height?: string | null;
  arm_height?: string | null;
  sit_height?: string | null;
  description?: string | null;
};

type SeedRow = {
  sku: string;
  original_name: string;
  category: string;
  source_file: string;
  catalog_data?: CatalogData;
};

const SEED_PATH = path.resolve(
  process.cwd(),
  "src",
  "generated",
  "sku-seed-data.json",
);

const CHUNK_SIZE = 200;

function nullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function main(): Promise<void> {
  const raw = await readFile(SEED_PATH, "utf8");
  const seed = JSON.parse(raw) as SeedRow[];
  if (!Array.isArray(seed) || seed.length === 0) {
    throw new Error(`Seed file empty or invalid: ${SEED_PATH}`);
  }

  const mappingRows = seed.map((item) => {
    if (!item.sku || !item.original_name || !item.category || !item.source_file) {
      throw new Error(`Invalid seed row: ${JSON.stringify(item)}`);
    }
    return {
      global_sku: item.sku,
      original_name: item.original_name,
      category: item.category,
      source_file: item.source_file,
      is_active: true,
    };
  });

  const db = getDb();
  let mappingsUpserted = 0;
  let catalogUpserted = 0;

  for (let i = 0; i < mappingRows.length; i += CHUNK_SIZE) {
    const mappingChunk = mappingRows.slice(i, i + CHUNK_SIZE);
    const seedChunk = seed.slice(i, i + CHUNK_SIZE);

    const mappingResult = await db
      .insert(sku_mappings)
      .values(mappingChunk)
      .onConflictDoUpdate({
        target: sku_mappings.global_sku,
        set: {
          original_name: sql`excluded.original_name`,
          category: sql`excluded.category`,
          source_file: sql`excluded.source_file`,
        },
      })
      .returning({ global_sku: sku_mappings.global_sku });
    mappingsUpserted += mappingResult.length;

    const catalogChunk = seedChunk
      .filter((item) => item.catalog_data && typeof item.catalog_data === "object")
      .map((item) => {
        const c = item.catalog_data!;
        return {
          global_sku: item.sku,
          msrp: nullableText(c.msrp),
          length: nullableText(c.length),
          depth: nullableText(c.depth),
          height: nullableText(c.height),
          arm_height: nullableText(c.arm_height),
          sit_height: nullableText(c.sit_height),
          description: nullableText(c.description),
          // image_url omitted on insert → NULL; never in ON CONFLICT SET
        };
      });

    if (catalogChunk.length === 0) continue;

    const catalogResult = await db
      .insert(finished_goods_catalog)
      .values(catalogChunk)
      .onConflictDoUpdate({
        target: finished_goods_catalog.global_sku,
        set: {
          msrp: sql`excluded.msrp`,
          length: sql`excluded.length`,
          depth: sql`excluded.depth`,
          height: sql`excluded.height`,
          arm_height: sql`excluded.arm_height`,
          sit_height: sql`excluded.sit_height`,
          description: sql`excluded.description`,
          // Preserve executive-owned image_url; do not set from seed.
          updated_at: sql`now()`,
        },
      })
      .returning({ global_sku: finished_goods_catalog.global_sku });
    catalogUpserted += catalogResult.length;
  }

  const counts = new Map<string, number>();
  for (const row of mappingRows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  console.log(`Seed file: ${SEED_PATH}`);
  console.log(`Dictionary size: ${mappingRows.length}`);
  console.log(
    `sku_mappings upserted: ${mappingsUpserted} (Katana / Woo / GHL / is_active preserved)`,
  );
  console.log(
    `finished_goods_catalog upserted: ${catalogUpserted} (image_url preserved)`,
  );
  for (const [category, count] of [...counts.entries()].sort()) {
    console.log(`  ${category}: ${count}`);
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
