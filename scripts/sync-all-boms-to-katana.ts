/**
 * Phase 3 — push the nested Supabase BOM tree into Katana.
 *
 * Dry-run is the default. It does not just count rows: it walks each finished
 * good's tree and reports which nodes already exist in Katana against which
 * would be created, because that distinction decides whether this run overwrites
 * the legacy flat recipes or builds a second catalogue beside them.
 *
 * Usage:
 *   npx tsx scripts/sync-all-boms-to-katana.ts                  # preflight
 *   npx tsx scripts/sync-all-boms-to-katana.ts --collection=ocean --limit=1
 *   npx tsx scripts/sync-all-boms-to-katana.ts --live            # mutate Katana
 *
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY), POSTGRES_URL.
 * A live run also needs ORDER_PIPELINE_MODE=live, which is what lets
 * syncBOMToKatana mutate at all.
 */
import { loadEnvConfig } from "@next/env";
import { asc, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import {
  item_operations,
  product_bom,
  sku_mappings,
} from "../src/server/db/schema";
import {
  createIntervalPacer,
  setKatanaRequestPacer,
  syncBOMToKatana,
} from "../src/lib/katana";
import { getOrderPipelineMode } from "../src/server/pipeline/mode";

loadEnvConfig(process.cwd());

const REQUEST_INTERVAL_MS = 1100;

const args = process.argv.slice(2);
const live = args.includes("--live");
const collectionArg = args
  .find((arg) => arg.startsWith("--collection="))
  ?.split("=")[1]
  ?.toLowerCase();
const limitArg = Number(
  args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "",
);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : null;

const COLLECTION_PREFIX: Readonly<Record<string, string>> = {
  ocean: "FIN-OCN-",
  bravada: "FIN-BRV-",
  brooklyn: "FIN-BRK-",
};

type NodeInfo = {
  sku: string;
  itemType: string;
  katanaVariantId: number | null;
  bomChildren: string[];
  operationCount: number;
};

type TreePlan = {
  fgSku: string;
  nodes: NodeInfo[];
  recipeRows: number;
  operationRows: number;
  missingChildren: string[];
  emptySubAssemblies: string[];
};

const nodeCache = new Map<string, NodeInfo | null>();

async function loadNode(sku: string): Promise<NodeInfo | null> {
  const cached = nodeCache.get(sku);
  if (cached !== undefined) return cached;

  const db = getDb();
  const [mapping] = await db
    .select({
      itemType: sku_mappings.item_type,
      katanaVariantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!mapping) {
    nodeCache.set(sku, null);
    return null;
  }

  const children = await db
    .select({ childSku: product_bom.child_sku })
    .from(product_bom)
    .where(eq(product_bom.parent_sku, sku))
    .orderBy(asc(product_bom.child_sku));

  const [ops] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(item_operations)
    .where(eq(item_operations.item_sku, sku));

  const info: NodeInfo = {
    sku,
    itemType: mapping.itemType,
    katanaVariantId: mapping.katanaVariantId,
    bomChildren: children.map((row) => row.childSku),
    operationCount: Number(ops?.n ?? 0),
  };
  nodeCache.set(sku, info);
  return info;
}

/** Walk one finished good the same way syncBOMToKatana does. */
async function planTree(fgSku: string): Promise<TreePlan> {
  const nodes: NodeInfo[] = [];
  const seen = new Set<string>();
  const missingChildren: string[] = [];
  const emptySubAssemblies: string[] = [];
  let recipeRows = 0;
  let operationRows = 0;

  async function walk(sku: string): Promise<void> {
    if (seen.has(sku)) return;
    seen.add(sku);

    const node = await loadNode(sku);
    if (!node) {
      missingChildren.push(sku);
      return;
    }
    nodes.push(node);
    recipeRows += node.bomChildren.length;
    operationRows += node.operationCount;

    if (node.itemType === "sub_assembly" && node.bomChildren.length === 0) {
      emptySubAssemblies.push(sku);
    }

    for (const child of node.bomChildren) {
      const childNode = await loadNode(child);
      if (!childNode) {
        missingChildren.push(child);
        continue;
      }
      if (childNode.itemType === "sub_assembly") {
        await walk(child);
      } else if (!seen.has(child)) {
        seen.add(child);
        nodes.push(childNode);
      }
    }
  }

  await walk(fgSku);
  return {
    fgSku,
    nodes,
    recipeRows,
    operationRows,
    missingChildren,
    emptySubAssemblies,
  };
}

async function targetFinishedGoods(): Promise<string[]> {
  const db = getDb();
  const prefixes = collectionArg
    ? [COLLECTION_PREFIX[collectionArg]]
    : Object.values(COLLECTION_PREFIX);
  if (prefixes.some((prefix) => !prefix)) {
    throw new Error(
      `Unknown --collection=${collectionArg}. Use ocean, bravada or brooklyn.`,
    );
  }

  const rows = await db
    .select({ globalSku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(
      sql`${sku_mappings.item_type} = 'finished_good'
        and ${sku_mappings.is_active} = true
        and exists (
          select 1 from ${product_bom}
          where ${product_bom.parent_sku} = ${sku_mappings.global_sku}
        )
        and (${sql.join(
          prefixes.map((prefix) => sql`${sku_mappings.global_sku} like ${`${prefix}%`}`),
          sql` or `,
        )})`,
    )
    .orderBy(asc(sku_mappings.global_sku));

  const skus = rows.map((row) => row.globalSku);
  return limit ? skus.slice(0, limit) : skus;
}

function summarizePreflight(plans: TreePlan[]): void {
  const createFg = new Set<string>();
  const createSa = new Set<string>();
  const createRm = new Set<string>();
  const mapped = new Set<string>();
  let recipePosts = 0;
  let operationPosts = 0;

  for (const plan of plans) {
    for (const node of plan.nodes) {
      const bucket =
        node.itemType === "finished_good"
          ? createFg
          : node.itemType === "sub_assembly"
            ? createSa
            : createRm;
      if (node.katanaVariantId == null) bucket.add(node.sku);
      else mapped.add(node.sku);
    }
    // syncBOMToKatana posts one /recipes batch per node that has children, and
    // one /product_operation_rows batch per node that has a routing.
    const producible = plan.nodes.filter(
      (node) => node.itemType !== "raw_material",
    );
    recipePosts += producible.filter((node) => node.bomChildren.length > 0).length;
    operationPosts += producible.filter((node) => node.operationCount > 0).length;
  }

  const creates = createFg.size + createSa.size + createRm.size;
  const calls = creates + recipePosts + operationPosts;

  console.log("\n=== preflight");
  console.log(`  finished goods targeted:        ${plans.length}`);
  console.log(`  nodes already mapped to Katana: ${mapped.size}`);
  console.log(
    `  nodes Katana does NOT have yet: ${creates}  (fg ${createFg.size} / sub-assembly ${createSa.size} / raw material ${createRm.size})`,
  );
  console.log(`  /recipes batches to post:       ${recipePosts}`);
  console.log(`  /product_operation_rows posts:  ${operationPosts}`);
  console.log(
    `  estimated Katana requests:      ~${calls} (>= ${((calls * REQUEST_INTERVAL_MS) / 60000).toFixed(1)} min at ${REQUEST_INTERVAL_MS}ms spacing)`,
  );

  const missing = new Set(plans.flatMap((plan) => plan.missingChildren));
  if (missing.size > 0) {
    console.log(`\n  components absent from sku_mappings: ${missing.size}`);
    for (const sku of [...missing].sort().slice(0, 10)) {
      console.log(`    ${sku}`);
    }
  }

  const empty = new Set(plans.flatMap((plan) => plan.emptySubAssemblies));
  if (empty.size > 0) {
    console.log(
      `\n  sub-assemblies with no cut-list (sync as structured but empty): ${empty.size}`,
    );
  }

  if (createFg.size > 0 || createSa.size > 0) {
    console.log(
      `\n  NOTE: ${createFg.size + createSa.size} producible nodes have no katana_variant_id, so`,
    );
    console.log(
      "        syncBOMToKatana will CREATE new Katana products for them rather than",
    );
    console.log(
      "        rewriting the existing colour-variant products. The legacy flat recipes",
    );
    console.log(
      "        stay where they are, and Katana ends up holding both catalogues.",
    );
  }
}

async function runLive(targets: string[]): Promise<void> {
  const mode = getOrderPipelineMode();
  if (mode !== "live") {
    console.error(
      `\nORDER_PIPELINE_MODE is "${mode}", so syncBOMToKatana will not mutate Katana.`,
    );
    console.error("Set ORDER_PIPELINE_MODE=live to run the sync for real.");
    process.exitCode = 1;
    return;
  }

  setKatanaRequestPacer(createIntervalPacer(REQUEST_INTERVAL_MS));

  let synced = 0;
  let failed = 0;
  const skipped = 0;
  const failures: Array<{ sku: string; error: string }> = [];

  for (const [index, sku] of targets.entries()) {
    const label = `[${index + 1}/${targets.length}] ${sku}`;
    try {
      const result = await syncBOMToKatana(sku);
      if (result.ok) {
        synced += 1;
        console.log(
          `  ${label} ok — nodes=${result.nodesSynced ?? "?"} recipeRows=${result.recipeRows ?? "?"}`,
        );
      } else {
        failed += 1;
        failures.push({ sku, error: result.error ?? "unknown" });
        console.error(`  ${label} FAILED — ${result.error}`);
      }
    } catch (error: unknown) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ sku, error: message });
      console.error(`  ${label} FAILED — ${message}`);
    }
  }

  setKatanaRequestPacer(null);

  console.log(`\nSynced: ${synced}, Failed: ${failed}, Skipped: ${skipped}`);
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const failure of failures.slice(0, 20)) {
      console.log(`  ${failure.sku}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log(
    live ? "Grand Katana sync — LIVE" : "Grand Katana sync — dry-run (default)",
  );
  console.log(`ORDER_PIPELINE_MODE=${getOrderPipelineMode()}`);

  const targets = await targetFinishedGoods();
  if (targets.length === 0) {
    console.log("No finished goods with a nested BOM matched.");
    return;
  }

  const plans: TreePlan[] = [];
  for (const sku of targets) {
    plans.push(await planTree(sku));
  }

  if (!live) {
    summarizePreflight(plans);
    console.log(
      `\nSynced: 0, Failed: 0, Skipped: ${plans.length} (dry-run — pass --live to execute)`,
    );
    return;
  }

  await runLive(targets);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
