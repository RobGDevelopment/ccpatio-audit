/**
 * Fail-closed Katana ID backfill for sku_mappings.
 *
 * Reads docs/_katana_raw_scrape.json (from npm run db:scrape-katana), matches
 * each Global E2E SKU to a Katana variant/material `sku` field, and updates
 * katana_variant_id / katana_material_id. Never invents IDs — misses are logged.
 *
 * Usage (from middleware/): npx tsx scripts/backfill-katana-ids.ts
 */
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const SCRAPE_FILE = path.resolve(
  process.cwd(),
  "..",
  "docs",
  "_katana_raw_scrape.json",
);

type KatanaRow = { id: number; sku: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractRows(scrapeSection: unknown): KatanaRow[] {
  const section = asRecord(scrapeSection);
  if (!section) return [];
  if (!section.ok) {
    console.error(
      `Scrape section not ok (status=${String(section.status)}). Re-run db:scrape-katana after Katana re-auth.`,
    );
    return [];
  }

  const body = section.body;
  let items: unknown[] = [];
  if (Array.isArray(body)) {
    items = body;
  } else {
    const record = asRecord(body);
    const candidate =
      record?.data ?? record?.results ?? record?.variants ?? record?.materials;
    if (Array.isArray(candidate)) items = candidate;
  }

  const rows: KatanaRow[] = [];
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const idRaw = rec.id ?? rec.variant_id ?? rec.material_id;
    const skuRaw = rec.sku ?? rec.SKU ?? rec.variant_sku;
    const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
    const sku = typeof skuRaw === "string" ? skuRaw.trim() : "";
    if (!Number.isFinite(id) || !sku) continue;
    rows.push({ id, sku });
  }
  return rows;
}

function indexBySku(rows: KatanaRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.sku.toUpperCase();
    if (map.has(key) && map.get(key) !== row.id) {
      console.warn(
        `WARNING: duplicate Katana sku ${JSON.stringify(row.sku)} with different ids; keeping first.`,
      );
      continue;
    }
    map.set(key, row.id);
  }
  return map;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(SCRAPE_FILE, "utf8");
  } catch {
    console.error(
      `Missing ${SCRAPE_FILE}. Run: npm run db:scrape-katana (requires valid KATANA_API_KEY).`,
    );
    process.exitCode = 1;
    return;
  }

  const scrape = JSON.parse(raw) as {
    variants?: unknown;
    materials?: unknown;
  };
  const variantIndex = indexBySku(extractRows(scrape.variants));
  const materialIndex = indexBySku(extractRows(scrape.materials));

  console.log(
    `Loaded Katana indexes: variants=${variantIndex.size}, materials=${materialIndex.size}`,
  );
  if (variantIndex.size === 0 && materialIndex.size === 0) {
    console.error("No Katana rows to match. Fail closed — no IDs written.");
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const mappings = await db.select().from(sku_mappings);

  let variantHits = 0;
  let materialHits = 0;
  const misses: string[] = [];

  for (const row of mappings) {
    const key = row.global_sku.toUpperCase();
    const variantId = variantIndex.get(key) ?? null;
    const materialId = materialIndex.get(key) ?? null;

    if (variantId === null && materialId === null) {
      misses.push(row.global_sku);
      continue;
    }

    const nextVariant = variantId ?? row.katana_variant_id;
    const nextMaterial = materialId ?? row.katana_material_id;
    if (
      nextVariant === row.katana_variant_id &&
      nextMaterial === row.katana_material_id
    ) {
      if (variantId !== null) variantHits += 1;
      if (materialId !== null) materialHits += 1;
      continue;
    }

    await db
      .update(sku_mappings)
      .set({
        katana_variant_id: nextVariant,
        katana_material_id: nextMaterial,
      })
      .where(eq(sku_mappings.global_sku, row.global_sku));

    if (variantId !== null) variantHits += 1;
    if (materialId !== null) materialHits += 1;
  }

  console.log(`Mappings scanned: ${mappings.length}`);
  console.log(`Variant matches:  ${variantHits}`);
  console.log(`Material matches: ${materialHits}`);
  console.log(`Unmatched (left NULL): ${misses.length}`);
  if (misses.length > 0) {
    console.log("Punchlist (first 40):");
    for (const sku of misses.slice(0, 40)) {
      console.log(`  ${sku}`);
    }
    if (misses.length > 40) {
      console.log(`  … +${misses.length - 40} more`);
    }
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
