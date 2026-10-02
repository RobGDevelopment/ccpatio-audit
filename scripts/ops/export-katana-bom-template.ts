/**
 * Export Hub live product_bom trees for active Finished Goods into Katana's
 * "Add new recipes" bulk-import CSV (native text — no xlsx XML wrapper).
 *
 * Scope: active finished_good SKUs with ≥1 live product_bom row.
 * Emits every nested recipe edge under those roots (FG→ASM, ASM→RM/…),
 * matching Katana's Product recipes (BOM) column headers.
 *
 * Quantity pushed = quantity * scrap_factor (same as Katana sync).
 *
 * Before write: aggregate by (parent SKU, ingredient SKU) — sum quantities,
 * join distinct Notes with " | " — so Katana never sees duplicate ingredients
 * on one parent recipe (importer rejects that).
 *
 *   npm run ops:export-katana-bom-template
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import {
  aggregateKatanaRecipeRows,
  toKatanaCsv,
  type KatanaRecipeRow,
} from "../../src/lib/katana-bom-csv";
import { closeDb, getDb } from "../../src/server/db/client";

loadEnvConfig(process.cwd());

const OUT_PATH = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-recipes.csv",
);

/** Official Katana "Add new recipes" headers (required columns first). */
const HEADERS = [
  "Product variant code / SKU (required)",
  "Product variant name",
  "Ingredient variant code / SKU (required)",
  "Ingredient variant name",
  "Notes",
  "Quantity (required)",
] as const;

type EdgeRow = {
  product_sku: string;
  product_name: string;
  ingredient_sku: string;
  ingredient_name: string;
  notes: string;
  quantity: number;
};

function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Katana accepts decimals; keep 4 dp to match Hub numeric(12,4)
  return Math.round(n * 10000) / 10000;
}

async function loadRecipeEdges(): Promise<{
  edges: EdgeRow[];
  fgCount: number;
  parentCount: number;
}> {
  const db = getDb();

  /**
   * 1) Active FG roots with live BOM
   * 2) Recursive walk of product_bom under those roots
   * 3) Distinct parent→child edges (SA recipes shared across FGs appear once)
   * 4) Quantity = Hub quantity * scrap_factor
   *
   * Note: DISTINCT ON keeps one qty/notes pair. Final CSV write still runs
   * aggregateKatanaRecipeRows so any residual duplicate (parent, ingredient)
   * pairs are summed and notes concatenated.
   */
  const result = await db.execute(sql`
    WITH RECURSIVE
    fg_roots AS (
      SELECT
        sm.global_sku AS root_sku
      FROM sku_mappings sm
      WHERE sm.item_type = 'finished_good'
        AND sm.is_active = true
        AND EXISTS (
          SELECT 1 FROM product_bom pb WHERE pb.parent_sku = sm.global_sku
        )
    ),
    bom_walk AS (
      SELECT
        fr.root_sku,
        pb.parent_sku,
        pb.child_sku,
        pb.quantity,
        pb.scrap_factor,
        pb.notes,
        1 AS depth,
        ARRAY[pb.parent_sku, pb.child_sku]::text[] AS path
      FROM product_bom pb
      INNER JOIN fg_roots fr ON fr.root_sku = pb.parent_sku
      UNION ALL
      SELECT
        bw.root_sku,
        pb.parent_sku,
        pb.child_sku,
        pb.quantity,
        pb.scrap_factor,
        pb.notes,
        bw.depth + 1,
        bw.path || pb.child_sku
      FROM product_bom pb
      INNER JOIN bom_walk bw ON pb.parent_sku = bw.child_sku
      WHERE bw.depth < 12
        AND NOT (pb.child_sku = ANY (bw.path))
    ),
    edges AS (
      SELECT DISTINCT ON (parent_sku, child_sku)
        parent_sku,
        child_sku,
        quantity,
        scrap_factor,
        notes
      FROM bom_walk
      ORDER BY parent_sku, child_sku, depth ASC
    )
    SELECT
      e.parent_sku AS product_sku,
      COALESCE(p.original_name, '') AS product_name,
      e.child_sku AS ingredient_sku,
      COALESCE(c.original_name, '') AS ingredient_name,
      COALESCE(e.notes, '') AS notes,
      (e.quantity::numeric * COALESCE(NULLIF(e.scrap_factor, 0), 1))::float8
        AS quantity
    FROM edges e
    LEFT JOIN sku_mappings p ON p.global_sku = e.parent_sku
    LEFT JOIN sku_mappings c ON c.global_sku = e.child_sku
    ORDER BY e.parent_sku ASC, e.child_sku ASC
  `);

  const raw = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);

  const edges: EdgeRow[] = raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        product_sku: String(r.product_sku ?? "").trim().toUpperCase(),
        product_name: String(r.product_name ?? ""),
        ingredient_sku: String(r.ingredient_sku ?? "").trim().toUpperCase(),
        ingredient_name: String(r.ingredient_name ?? ""),
        notes: String(r.notes ?? ""),
        quantity: roundQty(Number(r.quantity ?? 0)),
      };
    })
    .filter(
      (e) => e.product_sku && e.ingredient_sku && e.quantity > 0,
    );

  const fgResult = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM sku_mappings sm
    WHERE sm.item_type = 'finished_good'
      AND sm.is_active = true
      AND EXISTS (
        SELECT 1 FROM product_bom pb WHERE pb.parent_sku = sm.global_sku
      )
  `);
  const fgRaw = Array.isArray(fgResult)
    ? fgResult
    : ((fgResult as { rows?: unknown[] }).rows ?? []);
  const fgCount = Number((fgRaw[0] as { n?: number } | undefined)?.n ?? 0);

  const parentCount = new Set(edges.map((e) => e.product_sku)).size;

  return { edges, fgCount, parentCount };
}

async function main() {
  const { edges, fgCount, parentCount } = await loadRecipeEdges();

  const beforeCount = edges.length;
  const aggregated = aggregateKatanaRecipeRows(
    edges.map(
      (e): KatanaRecipeRow => ({
        productSku: e.product_sku,
        productName: e.product_name,
        ingredientSku: e.ingredient_sku,
        ingredientName: e.ingredient_name,
        notes: e.notes,
        quantity: e.quantity,
      }),
    ),
  );
  const collapsed = beforeCount - aggregated.length;

  const aoa: (string | number)[][] = [
    [...HEADERS],
    ...aggregated.map((e) => [
      e.productSku,
      e.productName,
      e.ingredientSku,
      e.ingredientName,
      e.notes,
      e.quantity,
    ]),
  ];

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  try {
    unlinkSync(OUT_PATH);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new Error(
        `Cannot overwrite ${OUT_PATH} (${code ?? "locked"}). Close the file if it is open in Excel, then re-run.`,
      );
    }
  }
  writeFileSync(OUT_PATH, toKatanaCsv(aoa), "utf8");

  const dataRows = aggregated.length;
  console.log(`✅ Wrote ${dataRows} recipe row(s) → ${OUT_PATH}`);
  console.log(
    `   Active FG with live BOM: ${fgCount}  |  Distinct recipe parents (FG+SA): ${parentCount}`,
  );
  if (collapsed > 0) {
    console.log(
      `   Aggregated ${collapsed} duplicate parent+ingredient row(s) (qty summed, notes joined)`,
    );
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
