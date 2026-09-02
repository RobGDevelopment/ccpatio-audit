/**
 * Gap analysis: Katana live state vs local seed + Supabase.
 *
 * Prerequisites: npx tsx scripts/katana-live-pull.ts
 * Usage: npx tsx scripts/analyze-katana-gap.ts
 *
 * Writes docs/katana_live_state/GAP_ANALYSIS_REPORT.md
 */
import { loadEnvConfig } from "@next/env";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const LIVE_DIR = path.resolve(process.cwd(), "docs", "katana_live_state");
const SEED_PATH = path.resolve(
  process.cwd(),
  "src",
  "generated",
  "sku-seed-data.json",
);
const REPORT_PATH = path.join(LIVE_DIR, "GAP_ANALYSIS_REPORT.md");

type JsonFile = { meta?: Record<string, unknown>; data?: unknown[] };

type SeedRow = {
  sku: string;
  original_name: string;
  category: string;
  source_file: string;
};

type VariantRow = {
  id?: number;
  sku?: string;
  product_id?: number | null;
  material_id?: number | null;
  type?: string;
};

type RecipeRow = Record<string, unknown>;
type OperationRow = Record<string, unknown>;

function normSku(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

async function loadJsonArray(fileName: string): Promise<{
  meta: Record<string, unknown>;
  rows: unknown[];
  missing: boolean;
}> {
  const full = path.join(LIVE_DIR, fileName);
  try {
    const raw = await readFile(full, "utf8");
    const parsed = JSON.parse(raw) as JsonFile;
    return {
      meta: parsed.meta ?? {},
      rows: Array.isArray(parsed.data) ? parsed.data : [],
      missing: false,
    };
  } catch {
    return { meta: {}, rows: [], missing: true };
  }
}

function asVariant(row: unknown): VariantRow | null {
  if (!row || typeof row !== "object") return null;
  return row as VariantRow;
}

function recipeProductVariantId(row: RecipeRow): number | null {
  const keys = [
    "product_variant_id",
    "variant_id",
    "product_id",
    "parent_variant_id",
  ];
  for (const key of keys) {
    const val = row[key];
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function operationName(row: OperationRow): string {
  const candidates = [
    row.operation_name,
    row.name,
    row.resource_name,
    row.work_center,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "(unnamed)";
}

function mdList(items: string[], limit = 50): string {
  if (items.length === 0) return "_None._\n";
  const slice = items.slice(0, limit);
  const lines = slice.map((i) => `- ${i}`);
  if (items.length > limit) {
    lines.push(`- _…and ${items.length - limit} more_`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const [variantsFile, recipesFile, opsFile, productsFile, materialsFile, opsAltFile] =
    await Promise.all([
      loadJsonArray("variants.json"),
      loadJsonArray("recipes.json"),
      loadJsonArray("product_operation_rows.json"),
      loadJsonArray("products.json"),
      loadJsonArray("materials.json"),
      loadJsonArray("operations.json"),
    ]);

  const seedRaw = await readFile(SEED_PATH, "utf8");
  const seed = JSON.parse(seedRaw) as SeedRow[];

  let dbMappings: Array<{
    global_sku: string;
    katana_variant_id: number | null;
    katana_material_id: number | null;
    category: string;
    original_name: string;
  }> = [];
  let dbCatalogCount = 0;
  let dbSource = "unavailable";

  try {
    const db = getDb();
    dbMappings = await db
      .select({
        global_sku: sku_mappings.global_sku,
        katana_variant_id: sku_mappings.katana_variant_id,
        katana_material_id: sku_mappings.katana_material_id,
        category: sku_mappings.category,
        original_name: sku_mappings.original_name,
      })
      .from(sku_mappings);
    const catalogRows = await db
      .select({ global_sku: finished_goods_catalog.global_sku })
      .from(finished_goods_catalog);
    dbCatalogCount = catalogRows.length;
    dbSource = "live Supabase (POSTGRES_URL)";
  } catch (error) {
    dbSource = `seed fallback — DB error: ${error instanceof Error ? error.message : String(error)}`;
    dbMappings = seed.map((r) => ({
      global_sku: r.sku,
      katana_variant_id: null,
      katana_material_id: null,
      category: r.category,
      original_name: r.original_name,
    }));
  } finally {
    await closeDb();
  }

  const variants = variantsFile.rows.map(asVariant).filter(Boolean) as VariantRow[];
  const katanaSkuToVariant = new Map<string, VariantRow>();
  const katanaVariantIdToSku = new Map<number, string>();
  for (const v of variants) {
    const sku = normSku(v.sku);
    if (!sku || v.id == null) continue;
    katanaSkuToVariant.set(sku, v);
    katanaVariantIdToSku.set(v.id, sku);
  }

  const localSkuSet = new Set(dbMappings.map((m) => normSku(m.global_sku)));
  const seedSkuSet = new Set(seed.map((r) => normSku(r.sku)));
  const katanaSkuSet = new Set(katanaSkuToVariant.keys());

  const matchingLocalKatana: string[] = [];
  const localOnly: string[] = [];
  const katanaOnly: string[] = [];

  for (const sku of localSkuSet) {
    if (katanaSkuSet.has(sku)) matchingLocalKatana.push(sku);
    else localOnly.push(sku);
  }
  for (const sku of katanaSkuSet) {
    if (!localSkuSet.has(sku)) katanaOnly.push(sku);
  }

  const seedOnlyVsKatana = [...seedSkuSet].filter((s) => !katanaSkuSet.has(s));
  const seedMatchKatana = [...seedSkuSet].filter((s) => katanaSkuSet.has(s));

  const recipes = recipesFile.rows as RecipeRow[];
  const productVariantIdsWithRecipe = new Set<number>();
  for (const row of recipes) {
    const id = recipeProductVariantId(row);
    if (id != null) productVariantIdsWithRecipe.add(id);
  }

  const productVariants = variants.filter(
    (v) => v.product_id != null && v.id != null,
  );
  const productsWithoutRecipe = productVariants.filter(
    (v) => !productVariantIdsWithRecipe.has(v.id!),
  );

  const operationsSource =
    opsFile.rows.length > 0 ? opsFile : opsAltFile;
  const operationRows = operationsSource.rows as OperationRow[];
  const operationNames = new Map<string, number>();
  for (const row of operationRows) {
    const name = operationName(row);
    operationNames.set(name, (operationNames.get(name) ?? 0) + 1);
  }
  const sortedOps = [...operationNames.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let idMatch = 0;
  let idMismatch = 0;
  let idMissingLocal = 0;
  let idStaleLocal = 0;
  let localWithAnyKatanaId = 0;
  let localIdsNotInKatana = 0;
  const mismatchSamples: string[] = [];
  const katanaVariantIdSet = new Set(variants.map((v) => v.id).filter((id) => id != null));

  for (const m of dbMappings) {
    if (m.katana_variant_id != null || m.katana_material_id != null) {
      localWithAnyKatanaId += 1;
      const vid = m.katana_variant_id;
      if (vid != null && !katanaVariantIdSet.has(vid)) {
        localIdsNotInKatana += 1;
      }
    }

    const sku = normSku(m.global_sku);
    const katana = katanaSkuToVariant.get(sku);
    if (!katana?.id) continue;

    const localVid = m.katana_variant_id;
    const localMid = m.katana_material_id;

    if (localVid == null && localMid == null) {
      idMissingLocal += 1;
      continue;
    }

    const katanaVid = katana.id;
    const katanaMid = katana.material_id ?? null;

    const variantOk = localVid == null || localVid === katanaVid;
    const materialOk =
      localMid == null ||
      katanaMid == null ||
      localMid === katanaMid ||
      localMid === katanaVid;

    if (variantOk && materialOk && localVid === katanaVid) {
      idMatch += 1;
    } else if (!variantOk || (localMid != null && katanaMid != null && localMid !== katanaMid)) {
      idMismatch += 1;
      if (mismatchSamples.length < 25) {
        mismatchSamples.push(
          `${sku}: local variant=${localVid ?? "NULL"} material=${localMid ?? "NULL"} vs Katana variant=${katanaVid} material=${katanaMid ?? "NULL"}`,
        );
      }
    } else if (localVid != null && localVid !== katanaVid) {
      idStaleLocal += 1;
    }
  }

  function prefixStats(skus: Iterable<string>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const sku of skus) {
      const prefix = sku.includes("-") ? sku.split("-")[0]! : sku.slice(0, 3);
      counts[prefix] = (counts[prefix] ?? 0) + 1;
    }
    return Object.fromEntries(
      Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12),
    );
  }

  const katanaPrefixStats = prefixStats(katanaSkuSet);
  const localPrefixStats = prefixStats(localSkuSet);

  const pulledAt =
    (variantsFile.meta.pulledAt as string | undefined) ??
    new Date().toISOString();

  const report = `# Katana ↔ Local PIM Gap Analysis

_Generated: ${new Date().toISOString()}_  
_Katana pull timestamp: ${pulledAt}_  
_Local comparison source: ${dbSource}_

## Pull summary

| Endpoint | Status | Records | Pages | Notes |
|----------|--------|---------|-------|-------|
| \`/products\` | ${productsFile.meta.ok === false ? "FAIL" : "OK"} | ${productsFile.rows.length} | ${productsFile.meta.pagesFetched ?? "?"} | ${productsFile.missing ? "file missing" : ""} |
| \`/variants\` | ${variantsFile.meta.ok === false ? "FAIL" : "OK"} | ${variants.length} | ${variantsFile.meta.pagesFetched ?? "?"} | SKU matching key |
| \`/materials\` | ${materialsFile.meta.ok === false ? "FAIL" : "OK"} | ${materialsFile.rows.length} | ${materialsFile.meta.pagesFetched ?? "?"} | |
| \`/recipes\` | ${recipesFile.meta.ok === false ? "FAIL" : "OK"} | ${recipes.length} | ${recipesFile.meta.pagesFetched ?? "?"} | BOM/recipe rows |
| \`/product_operation_rows\` | ${opsFile.meta.ok === false ? "FAIL" : "OK"} | ${opsFile.rows.length} | ${opsFile.meta.pagesFetched ?? "?"} | standard product operations |
| \`/operations\` | ${opsAltFile.meta.ok === false ? "FAIL" : "OK"} | ${opsAltFile.rows.length} | ${opsAltFile.meta.pagesFetched ?? "?"} | ${opsAltFile.meta.error ? String(opsAltFile.meta.error) : "fallback if product ops empty"} |

## A) SKU overlap — Katana vs local

| Metric | Count |
|--------|------:|
| Katana variants (with SKU) | ${katanaSkuSet.size} |
| Local \`sku_mappings\` | ${localSkuSet.size} |
| Seed file (\`sku-seed-data.json\`) | ${seedSkuSet.size} |
| **Matching SKUs** (in both Katana + local) | **${matchingLocalKatana.length}** |
| **Local-only** (in DB/seed, not in Katana) | **${localOnly.length}** |
| **Katana-only** (in Katana, not in local) | **${katanaOnly.length}** |
| Seed matches Katana | ${seedMatchKatana.length} |
| Seed missing from Katana | ${seedOnlyVsKatana.length} |
| \`finished_goods_catalog\` rows (DB) | ${dbCatalogCount} |

### SKU namespace mismatch (root cause of 0 exact matches)

Katana and the local PIM use **different SKU taxonomies**. Katana carries legacy factory configurables (\`BRA-*\`, \`DBT-*\`, \`D-*\` Dekton); local \`sku_mappings\` uses Global E2E prefixes (\`FIN-*\`, \`FAB-*\`, \`STN-DKT-*\`, \`FRP-*\`, etc.).

**Katana variant prefix distribution (top):**

\`\`\`json
${JSON.stringify(katanaPrefixStats, null, 2)}
\`\`\`

**Local sku_mappings prefix distribution (top):**

\`\`\`json
${JSON.stringify(localPrefixStats, null, 2)}
\`\`\`

Exact string matching cannot link these namespaces without an explicit **alias / crosswalk table** (e.g. \`sku_aliases\` or a regenerated mapping from factory Base SKU → Global E2E SKU).

### Katana-only SKUs (first 50)

${mdList(katanaOnly.sort(), 50)}

### Local-only SKUs (first 50)

${mdList(localOnly.sort(), 50)}

## B) Products without BOM/Recipe

| Metric | Count |
|--------|------:|
| Katana product variants (has \`product_id\`) | ${productVariants.length} |
| Product variants with ≥1 recipe row | ${productVariants.length - productsWithoutRecipe.length} |
| **Product variants lacking recipe/BOM** | **${productsWithoutRecipe.length}** |

### Product variants without recipes (first 40)

${mdList(
  productsWithoutRecipe
    .map((v) => `${normSku(v.sku)} (variant_id=${v.id})`)
    .sort(),
  40,
)}

## C) Standard operations in Katana

_Source: \`${operationsSource === opsFile ? "/product_operation_rows" : "/operations"}\` (${operationRows.length} rows)_

| Operation name | Row count |
|----------------|----------:|
${sortedOps.map(([name, count]) => `| ${name.replace(/\|/g, "\\|")} | ${count} |`).join("\n")}

## D) Katana ID mapping vs \`sku_mappings\`

| Metric | Count |
|--------|------:|
| Local rows with matching Katana SKU (exact) | ${[...localSkuSet].filter((s) => katanaSkuSet.has(s)).length} |
| Local rows with any \`katana_variant_id\` or \`katana_material_id\` set | ${localWithAnyKatanaId} |
| Stored Katana variant IDs not found in live pull | ${localIdsNotInKatana} |
| Local rows with **no** Katana IDs but exact SKU exists in Katana | ${idMissingLocal} |
| Local IDs **match** Katana variant_id (exact SKU) | ${idMatch} |
| Local IDs **mismatch** Katana (exact SKU) | ${idMismatch} |
| Stale / partial ID issues | ${idStaleLocal} |

${matchingLocalKatana.length === 0 ? "**Recommendation:** SKU-string backfill (`db:backfill-katana`) cannot work until a crosswalk maps Global E2E SKUs → Katana legacy SKUs. Build aliases from Website Product Info Base SKU / finished-good rules, then backfill IDs from `docs/katana_live_state/variants.json`." : idMissingLocal > 0 || idMismatch > 0 ? "**Recommendation:** Run ID backfill from `docs/katana_live_state/variants.json` after alias crosswalk is in place." : "**Recommendation:** ID columns appear aligned for matched SKUs; spot-check before outbound sync."}

### ID mismatch samples

${mdList(mismatchSamples, 25)}

## Engineering next steps

1. **Build SKU crosswalk** — 0 exact SKU matches because Katana uses legacy factory codes vs Global E2E dictionary. Priority: map \`FIN-*\` / Base SKU ↔ \`BRA-*\` / \`DBT-*\` before any sync.
2. **Reconcile orphans** — ${katanaOnly.length} Katana SKUs absent from PIM; ${localOnly.length} PIM SKUs absent from Katana (mostly fabrics/Dekton not yet pushed).
3. **BOM gap** — ${productsWithoutRecipe.length} of ${productVariants.length} Katana product variants have no recipe rows (${Math.round((productsWithoutRecipe.length / Math.max(productVariants.length, 1)) * 100)}%).
4. **ID backfill** — ${localWithAnyKatanaId} local rows have Katana IDs stored; ${localIdsNotInKatana} stored IDs are stale vs live pull. String-match backfill is blocked until crosswalk exists.
5. **Operations parity** — Katana has ${sortedOps.length} distinct standard operations on ${operationRows.length} \`product_operation_rows\`; seed into local \`item_operations\` or treat Katana as SoT for routing.
6. **Push vs pull strategy** — Spreadsheets built the PIM; Katana holds production configurables. Decide per category: import Katana FG into PIM vs push PIM materials into Katana.

`;

  await writeFile(REPORT_PATH, report, "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(
    JSON.stringify(
      {
        matching: matchingLocalKatana.length,
        localOnly: localOnly.length,
        katanaOnly: katanaOnly.length,
        productsWithoutRecipe: productsWithoutRecipe.length,
        idMissingLocal,
        idMismatch,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  console.error(error);
  try {
    await closeDb();
  } catch {
    // ignore
  }
  process.exit(1);
});
