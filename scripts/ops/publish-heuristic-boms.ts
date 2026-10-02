/**
 * Heuristic catch-up recipes for in-house collections without a Day Zero cut-list.
 *
 * Default is dry-run. --confirm without --dry-run deletes each variant's
 * /bom_rows and posts the new set, then replaces hub product_bom.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/publish-heuristic-boms.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/publish-heuristic-boms.ts --dry-run --only FIN-BRV-SOF-84X34
 *   npx dotenv -e .env.local -- tsx scripts/ops/publish-heuristic-boms.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  HEURISTIC_POWDER_FALLBACK,
  HEURISTIC_POWDER_PREFERRED,
  HEURISTIC_SOFA_84_SKU,
  baseModelSku,
  buildHeuristicCatalogDocument,
  finishedGoodsInQuarantine,
  isFirepitBase,
  isTargetCollection,
  loadDayZeroQuarantine,
  thirdPartyBlockReason,
  type CatalogCandidate,
  type DayZeroQuarantineFile,
  type HeuristicCatalogDocument,
  type HeuristicCatalogParent,
  type HeuristicCatalogRow,
} from "../../src/lib/heuristic-catalog-bom";
import {
  KatanaApiError,
  createIntervalPacer,
  ensureKatanaVariantForSku,
  findVariantBySku,
  replaceKatanaVariantRecipe,
  setKatanaRequestPacer,
  type KatanaVariantRecord,
} from "../../src/lib/katana";
import { canMutateKatanaCatalog } from "../../src/server/pipeline/catalog-mode";
import { closeDb, getDb } from "../../src/server/db/client";
import { product_bom, product_bom_draft, sku_mappings } from "../../src/server/db/schema";
import { paginateKatana } from "./lib/katana-paginate";

loadEnvConfig(process.cwd());

const DAY_ZERO_PATH = path.join(process.cwd(), "tmp", "day-zero-bom-dry-run.json");
const SOFA_PATH = path.join(process.cwd(), "tmp", "heuristic-bom-bravada-sofa-84.json");

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");

function readOnlySku(): string | null {
  const inline = process.argv.find((arg) => arg.startsWith("--only="));
  if (inline) return inline.slice("--only=".length).trim().toUpperCase();
  const index = process.argv.indexOf("--only");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--only requires a finished-good SKU.");
  return value.trim().toUpperCase();
}

const onlySku = readOnlySku();

type ResolvedRow = HeuristicCatalogRow & { variantId: number | null };
type ResolvedParent = {
  role: HeuristicCatalogParent["role"];
  sku: string;
  variantId: number | null;
  productId: number | null;
  productAction: "reuse" | "create" | "needs_variant";
  rows: ResolvedRow[];
};

type ResolvedDocument = Omit<HeuristicCatalogDocument, "parents"> & {
  generatedAt: string;
  mode: "dry-run" | "confirm";
  parents: ResolvedParent[];
};

type KatanaProduct = {
  name?: string | null;
  category_name?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
  variants?: Array<{ sku?: string | null; deleted_at?: string | null }> | null;
};

function isGone(value: string | null | undefined): boolean {
  return value != null && String(value).trim() !== "";
}

function loadQuarantineFiles(): DayZeroQuarantineFile[] {
  const raw = JSON.parse(readFileSync(DAY_ZERO_PATH, "utf8")) as {
    files?: DayZeroQuarantineFile[];
  };
  return raw.files ?? [];
}

function categoryForSku(sku: string): string {
  if (sku.startsWith("FIN-BRV-")) return "Bravada Collection";
  if (sku.startsWith("FIN-BRK-")) return "Brooklyn Collection";
  if (sku.startsWith("FIN-OCN-")) return "Ocean Collection";
  if (sku.startsWith("FIN-MLN-")) return "Milan Collection";
  if (sku.startsWith("FIN-TAY-")) return "Taylor Collection";
  if (sku.startsWith("FIN-DAI-")) return "Daisy Collection";
  if (sku.startsWith("FIN-WFT-")) return "Waterfall Collection";
  if (isFirepitBase("", "", sku)) return "Firepit";
  return "Finished Good";
}

function collectCandidates(
  products: readonly KatanaProduct[],
  quarantine: ReadonlySet<string>,
): CatalogCandidate[] {
  const byBase = new Map<string, CatalogCandidate>();
  for (const product of products) {
    if (isGone(product.deleted_at) || isGone(product.archived_at)) continue;
    const category = String(product.category_name ?? "");
    const name = String(product.name ?? "");
    for (const variant of product.variants ?? []) {
      if (isGone(variant.deleted_at)) continue;
      const sku = String(variant.sku ?? "").trim().toUpperCase();
      if (!sku.startsWith("FIN-")) continue;
      const base = baseModelSku(sku);
      if (quarantine.has(base)) continue;
      if (thirdPartyBlockReason(category, name, base)) continue;
      if (!isTargetCollection(category, name, base) && !isFirepitBase(category, name, base)) {
        continue;
      }
      const existing = byBase.get(base);
      if (!existing || sku === base) {
        byBase.set(base, { finSku: base, name, category });
      }
    }
  }
  return [...byBase.values()].sort((a, b) => a.finSku.localeCompare(b.finSku));
}

const variantCache = new Map<string, KatanaVariantRecord | null>();

async function lookupSku(sku: string): Promise<KatanaVariantRecord | null> {
  const key = sku.trim().toUpperCase();
  if (variantCache.has(key)) return variantCache.get(key) ?? null;
  const found = await findVariantBySku(key);
  variantCache.set(key, found);
  return found;
}

async function resolveDocument(
  built: HeuristicCatalogDocument,
): Promise<ResolvedDocument> {
  const stamp = {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "confirm" as const : "dry-run" as const,
  };
  if (built.status === "skipped") {
    return { ...built, ...stamp, parents: [] };
  }

  const parents: ResolvedParent[] = [];
  for (const parent of built.parents) {
    const variant = await lookupSku(parent.sku);
    const rows: ResolvedRow[] = [];
    for (const line of parent.rows) {
      const ingredient = await lookupSku(line.ingredientSku);
      rows.push({ ...line, variantId: ingredient?.id ?? null });
    }
    parents.push({
      role: parent.role,
      sku: parent.sku,
      variantId: variant?.id ?? null,
      productId: variant?.product_id ?? null,
      productAction:
        parent.role === "finished_good"
          ? variant
            ? "reuse"
            : "needs_variant"
          : variant
            ? "reuse"
            : "create",
      rows,
    });
  }

  return { ...built, ...stamp, parents };
}

function assertPushable(doc: ResolvedDocument): void {
  if (doc.status !== "ready") {
    throw new Error(`${doc.finSku} is skipped (${doc.skipReason}).`);
  }
  const fin = doc.parents.find((parent) => parent.role === "finished_good");
  if (!fin?.variantId) throw new Error(`${doc.finSku} is not a live Katana variant.`);
  const createdHere = new Set(
    doc.parents.filter((parent) => parent.productAction === "create").map((parent) => parent.sku),
  );
  for (const parent of doc.parents) {
    for (const line of parent.rows) {
      if (line.variantId == null && !createdHere.has(line.ingredientSku)) {
        throw new Error(
          `${doc.finSku} ingredient ${line.ingredientSku} has no Katana variant. Refusing to delete recipes.`,
        );
      }
    }
  }
}

async function ensureHubSku(
  sku: string,
  itemType: "finished_good" | "sub_assembly" | "raw_material",
  uom: string,
  variantId: number | null,
  category: string,
): Promise<void> {
  if (itemType !== "sub_assembly" && variantId == null) {
    throw new Error(`${sku} has no Katana variant, so the hub row was not inserted.`);
  }
  const db = getDb();
  const [existing] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (existing) return;
  await db.insert(sku_mappings).values({
    global_sku: sku,
    category,
    item_type: itemType,
    original_name: sku,
    source_file: "heuristic-bom",
    uom_consume: uom,
    uom_purchase: uom,
    katana_variant_id: variantId,
    is_active: true,
  });
}

async function replaceHub(doc: ResolvedDocument): Promise<void> {
  const db = getDb();
  const parents = doc.parents.map((parent) => parent.sku);
  for (const parent of doc.parents) {
    if (parent.role === "finished_good") {
      await ensureHubSku(parent.sku, "finished_good", "ea", parent.variantId, doc.category);
    } else {
      await ensureHubSku(parent.sku, "sub_assembly", "ea", parent.variantId, doc.category);
    }
    for (const line of parent.rows) {
      if (line.ingredientSku.startsWith("ASM-") || line.ingredientSku.startsWith("SA-")) continue;
      await ensureHubSku(line.ingredientSku, "raw_material", line.uom, line.variantId, "Raw Material");
    }
  }
  const liveRows = doc.parents.flatMap((parent) =>
    parent.rows.map((line) => ({
      parent_sku: parent.sku,
      child_sku: line.ingredientSku,
      quantity: line.quantity.toFixed(4),
      scrap_factor: "1.0000",
      unit_of_measure: line.uom,
      notes: line.notes,
      cut_list: line.cutList,
    })),
  );
  const draftRows = liveRows.map((line) => ({
    ...line,
    status: "factory_approved" as const,
    source: "heuristic" as const,
    reviewed_by: "heuristic-bom",
    reviewed_at: new Date(),
  }));
  await db.transaction(async (tx) => {
    for (const parent of parents) {
      await tx.delete(product_bom).where(eq(product_bom.parent_sku, parent));
      await tx.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, parent));
    }
    if (liveRows.length > 0) await tx.insert(product_bom).values(liveRows);
    if (draftRows.length > 0) await tx.insert(product_bom_draft).values(draftRows);
  });
}

async function replaceKatana(doc: ResolvedDocument): Promise<void> {
  const order: Array<ResolvedParent["role"]> = ["cushion", "frame", "finished_good"];
  for (const role of order) {
    const parent = doc.parents.find((item) => item.role === role);
    if (!parent) continue;
    let variantId = parent.variantId;
    if (variantId == null && role !== "finished_good") {
      const ensured = await ensureKatanaVariantForSku(parent.sku);
      if (!ensured.ok) throw new Error(ensured.error);
      variantId = ensured.variantId;
      parent.variantId = variantId;
      const finished = doc.parents.find((item) => item.role === "finished_good");
      for (const line of finished?.rows ?? []) {
        if (line.ingredientSku === parent.sku) line.variantId = variantId;
      }
    }
    if (variantId == null) throw new Error(`${parent.sku} has no Katana variant.`);
    await replaceKatanaVariantRecipe(
      variantId,
      parent.rows.map((line) => ({
        ingredientVariantId: line.variantId!,
        quantity: line.quantity,
        notes: line.notes,
      })),
      `heuristic-bom:${parent.sku}`,
    );
    console.log(`  replaced ${parent.sku} variant ${variantId} rows=${parent.rows.length}`);
  }
}

function writeSofa(doc: ResolvedDocument | undefined): void {
  if (!doc) return;
  mkdirSync(path.dirname(SOFA_PATH), { recursive: true });
  writeFileSync(SOFA_PATH, JSON.stringify(doc, null, 2));
  console.log(`Wrote ${path.relative(process.cwd(), SOFA_PATH)}`);
}

function printSummary(doc: ResolvedDocument): void {
  console.log(`\n${doc.finSku}`);
  if (doc.status === "skipped") {
    console.log(`  skipped ${doc.skipReason}`);
    return;
  }
  console.log(
    `  family=${doc.family} ${doc.widthIn}x${doc.depthIn} height=${doc.heightIn} tubeNetFt=${doc.tubeNetFt.toFixed(4)} powder=${doc.powderSku}`,
  );
  for (const parent of doc.parents) {
    console.log(
      `  ${parent.role} ${parent.sku} variant=${parent.variantId ?? "none"} ${parent.productAction}`,
    );
    for (const line of parent.rows) {
      console.log(
        `    ${line.ingredientSku} ${line.quantity.toFixed(4)} ${line.uom} variant=${line.variantId ?? "none"}`,
      );
      if (line.notes) console.log(`      ${line.notes}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(confirm ? "LIVE confirm. Heuristic recipe replace is enabled." : "Dry-run. No Katana or hub writes.");
  setKatanaRequestPacer(createIntervalPacer(1300));

  const files = loadQuarantineFiles();
  const quarantine = loadDayZeroQuarantine(files);
  const quarantinedFins = finishedGoodsInQuarantine(files);
  console.log(
    `  day-zero quarantine: ${quarantinedFins.size} finished goods, ${quarantine.size} skus including frames and cushions`,
  );

  let candidates: CatalogCandidate[];
  if (onlySku) {
    candidates = [{ finSku: onlySku, name: onlySku, category: categoryForSku(onlySku) }];
    console.log(`  only: ${onlySku}`);
  } else {
    console.log("→ Fetching /products");
    const products = (await paginateKatana(
      "/products?include_deleted=false",
      "products",
    )) as KatanaProduct[];
    candidates = collectCandidates(products, quarantine);
    console.log(`  target base models: ${candidates.length}`);
  }

  const preferredPowder = await lookupSku(HEURISTIC_POWDER_PREFERRED);
  const powderSku = preferredPowder ? HEURISTIC_POWDER_PREFERRED : HEURISTIC_POWDER_FALLBACK;
  console.log(`  powder: ${powderSku}`);

  const docs: ResolvedDocument[] = [];
  for (const candidate of candidates) {
    const built = buildHeuristicCatalogDocument(candidate, { powderSku, quarantine });
    docs.push(await resolveDocument(built));
    if (docs.length === candidates.length || docs.length % 25 === 0) {
      console.log(`  resolved ${docs.length}/${candidates.length}`);
    }
  }

  const sofa = docs.find((doc) => doc.finSku === HEURISTIC_SOFA_84_SKU);
  writeSofa(sofa);
  for (const doc of docs) {
    if (doc.finSku === HEURISTIC_SOFA_84_SKU || docs.length === 1) printSummary(doc);
  }

  const ready = docs.filter((doc) => doc.status === "ready").length;
  const skipped = docs.length - ready;
  console.log("");
  console.log(`  ready: ${ready}`);
  console.log(`  skipped: ${skipped}`);
  if (!confirm) return;

  if (!canMutateKatanaCatalog()) {
    throw new Error("Refusing --confirm while catalog publish mode is not live.");
  }
  const failures: string[] = [];
  for (const doc of docs) {
    if (doc.status === "skipped") {
      console.log(`  skip ${doc.finSku} (${doc.skipReason})`);
      continue;
    }
    const fin = doc.parents.find((parent) => parent.role === "finished_good");
    if (fin?.productAction === "needs_variant") {
      console.log(`  skip ${doc.finSku} needs_variant`);
      continue;
    }
    try {
      assertPushable(doc);
      await replaceHub(doc);
      await replaceKatana(doc);
      console.log(`  hub + Katana replaced for ${doc.finSku}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${doc.finSku}: ${message}`);
      failures.push(`${doc.finSku}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} product(s) failed.\n${failures.join("\n")}`);
  }
}

const invoked = process.argv[1]?.replace(/\\/g, "/").includes("publish-heuristic-boms");
if (invoked) {
  main()
    .catch((error: unknown) => {
      if (error instanceof KatanaApiError && error.details != null) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
