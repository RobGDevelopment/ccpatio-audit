/**
 * Tally Finished Goods with approved / live BOM recipes (Hub SoT).
 *
 * Criteria for "active recipe":
 *   - sku_mappings.item_type = finished_good (typically FIN-*)
 *   - is_active = true
 *   - ≥1 live product_bom row (Approve copies drafts → live)
 *
 * Also reports factory_approved draft rollups and ops coverage.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/count-active-recipes.ts
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  item_operations,
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

type CoarseFamily = "Seating" | "Tables" | "Daybeds / Loungers" | "Other";

function coarseFamily(sku: string, name: string): CoarseFamily {
  const s = `${sku} ${name}`.toUpperCase();
  if (/\b(CHA|CHAIR|SOF|SOFA|SEC|SECTIONAL|LOV|LOVESEAT|OTT|OTTOMAN|BEN|BENCH|SWI|SWIVEL)\b/.test(s)) {
    return "Seating";
  }
  if (/\b(TAB|TABLE|DIN|DINING|COF|COFFEE|SID|SIDE|CON|CONSOLE)\b/.test(s)) {
    return "Tables";
  }
  if (/\b(DYB|DAY|DAYBED|CHAIS|LOUNG|CABANA)\b/.test(s)) {
    return "Daybeds / Loungers";
  }
  return "Other";
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printBreakdown(title: string, map: Map<string, number>) {
  console.log(`\n${title}`);
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  const width = Math.max(...rows.map(([k]) => k.length), 8);
  for (const [k, n] of rows) {
    console.log(`  ${k.padEnd(width)}  ${n}`);
  }
}

async function main() {
  const db = getDb();

  const finishedGoods = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      isActive: sku_mappings.is_active,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.item_type, "finished_good"));

  const liveBomCounts = await db
    .select({
      parent: product_bom.parent_sku,
      lines: sql<number>`count(*)::int`,
    })
    .from(product_bom)
    .groupBy(product_bom.parent_sku);

  const liveOpsCounts = await db
    .select({
      item: item_operations.item_sku,
      ops: sql<number>`count(*)::int`,
    })
    .from(item_operations)
    .groupBy(item_operations.item_sku);

  const approvedDraftParents = await db
    .selectDistinct({ parent: product_bom_draft.parent_sku })
    .from(product_bom_draft)
    .where(eq(product_bom_draft.status, "factory_approved"));

  const liveBomByParent = new Map(
    liveBomCounts.map((r) => [r.parent, Number(r.lines)]),
  );
  const liveOpsByItem = new Map(
    liveOpsCounts.map((r) => [r.item, Number(r.ops)]),
  );
  const approvedDraftSet = new Set(approvedDraftParents.map((r) => r.parent));

  const active = finishedGoods.filter((r) => r.isActive);
  const inactive = finishedGoods.length - active.length;

  const withLiveBom = active.filter((r) => (liveBomByParent.get(r.sku) ?? 0) > 0);
  const withApprovedDraft = active.filter((r) => approvedDraftSet.has(r.sku));
  const withLiveOps = withLiveBom.filter(
    (r) => (liveOpsByItem.get(r.sku) ?? 0) > 0,
  );

  const byCategory = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const byCategoryAllFg = new Map<string, number>();

  for (const r of active) {
    bump(byCategoryAllFg, r.category?.trim() || "(blank)");
  }
  for (const r of withLiveBom) {
    bump(byCategory, r.category?.trim() || "(blank)");
    bump(byFamily, coarseFamily(r.sku, r.name));
  }

  console.log("=== Finished Goods — Active Recipes (Hub) ===\n");
  console.log(`Total finished_good SKUs:           ${finishedGoods.length}`);
  console.log(`  Active (is_active=true):          ${active.length}`);
  console.log(`  Inactive:                         ${inactive}`);
  console.log("");
  console.log(
    `Finished Goods with LIVE BOM recipe: ${withLiveBom.length}  ← primary tally`,
  );
  console.log(
    `  …also have live operations:         ${withLiveOps.length}`,
  );
  console.log(
    `  …draft marked factory_approved:     ${withApprovedDraft.length}`,
  );
  console.log(
    `Active FG with NO live BOM yet:       ${active.length - withLiveBom.length}`,
  );

  printBreakdown("Breakdown by collection (sku_mappings.category) — live BOM:", byCategory);
  printBreakdown("Coarse family (SKU/name heuristic) — live BOM:", byFamily);
  printBreakdown("All active FG by collection (denominator):", byCategoryAllFg);

  if (withLiveBom.length > 0 && withLiveBom.length <= 40) {
    console.log("\nSKUs with live recipes:");
    for (const r of [...withLiveBom].sort((a, b) => a.sku.localeCompare(b.sku))) {
      const lines = liveBomByParent.get(r.sku) ?? 0;
      const ops = liveOpsByItem.get(r.sku) ?? 0;
      console.log(
        `  ${r.sku.padEnd(28)}  bom=${String(lines).padStart(2)}  ops=${String(ops).padStart(2)}  ${r.category}`,
      );
    }
  } else if (withLiveBom.length > 40) {
    console.log(`\n(${withLiveBom.length} SKUs — list omitted; >40)`);
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
