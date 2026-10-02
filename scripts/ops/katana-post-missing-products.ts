/**
 * Phase C: seed missing Product shells required by Add-new-recipes.csv.
 *
 * Why: Katana's bulk "Add new recipes" importer 422s when a parent OR
 * ingredient product SKU is missing. After material purge + remint, parents
 * were seeded first; ingredient-only SA-* shells (never a parent in the CSV)
 * still need POST /products.
 *
 * Unified SKU list:
 *   - All unique "Product variant code / SKU" (parents)
 *   - Unique "Ingredient variant code / SKU" that start with SA-/ASM-/FIN-/CUT-
 *     (ignore RM-/FAB-/PWD-/MET-/STN-/etc. materials)
 *
 * Katana API (this tenant + developer.katanamrp.com):
 *   GET  /variants
 *   POST /products   { name, uom, is_sellable, is_producible, is_purchasable,
 *                      variants: [{ sku }] }
 *
 * Note: Katana has no `is_manufactured` field. Manufactured = is_producible:true.
 *
 * Sellable rules (explicit):
 *   FIN-*              → is_sellable: true
 *   ASM- / SA- / CUT-  → is_sellable: false (WIP sub-assemblies)
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-post-missing-products
 *   npm run ops:katana-post-missing-products -- --dry-run
 *   npm run ops:katana-post-missing-products -- --confirm
 *   npm run ops:katana-post-missing-products -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm") && !explicitDryRun;
const dryRun = !confirm;

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

const limit = parseLimit();
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const RECIPES_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-recipes.csv",
);

type SkuRole = "parent" | "ingredient" | "both";

type ProductReq = {
  sku: string;
  name: string;
  role: SkuRole;
};

type KatanaVariant = {
  id: number;
  sku?: string | null;
  type?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
};

type PlanAction =
  | "would_post"
  | "posted"
  | "already_present"
  | "blocked_as_material"
  | "failed"
  | "skipped";

type PlanRow = {
  action: PlanAction;
  sku: string;
  name: string;
  role: SkuRole;
  is_sellable: boolean;
  is_producible: boolean;
  product_id: string;
  variant_id: string;
  status: string;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Product-shell prefixes only — never POST materials as products. */
function isProductShellSku(sku: string): boolean {
  const s = normalizeSku(sku);
  return (
    s.startsWith("SA-") ||
    s.startsWith("ASM-") ||
    s.startsWith("FIN-") ||
    s.startsWith("CUT-")
  );
}

/** Explicit sellable policy for Phase C product shells. */
function inferProductIsSellable(sku: string): boolean {
  const s = normalizeSku(sku);
  if (s.startsWith("FIN-")) return true;
  if (s.startsWith("ASM-") || s.startsWith("SA-") || s.startsWith("CUT-")) {
    return false;
  }
  return false;
}

function prefixOf(sku: string): string {
  const cut = sku.indexOf("-");
  return cut === -1 ? sku : sku.slice(0, cut + 1);
}

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for ${label} (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

/**
 * Unified deduped product shells from parent + ingredient columns.
 * Ingredient column: only SA-/ASM-/FIN-/CUT- (skip RM-/FAB-/etc.).
 */
function loadProductRequirements(): {
  products: ProductReq[];
  parentCount: number;
  ingredientShellCount: number;
  ingredientOnlyCount: number;
} {
  if (!existsSync(RECIPES_CSV)) {
    throw new Error(`Missing recipe import file: ${RECIPES_CSV}`);
  }
  const rows = readCsvRecords(RECIPES_CSV);
  const bySku = new Map<
    string,
    { name: string; asParent: boolean; asIngredient: boolean }
  >();

  for (const row of rows) {
    const parentSku = normalizeSku(
      col(
        row,
        "Product variant code / SKU (required)",
        "Product variant code / SKU",
      ),
    );
    if (parentSku) {
      const existing = bySku.get(parentSku);
      if (existing) {
        existing.asParent = true;
        if (!existing.name) {
          existing.name = col(row, "Product variant name", "Product name");
        }
      } else {
        bySku.set(parentSku, {
          name: col(row, "Product variant name", "Product name"),
          asParent: true,
          asIngredient: false,
        });
      }
    }

    const ingredientSku = normalizeSku(
      col(
        row,
        "Ingredient variant code / SKU (required)",
        "Ingredient variant code / SKU",
      ),
    );
    if (ingredientSku && isProductShellSku(ingredientSku)) {
      const existing = bySku.get(ingredientSku);
      if (existing) {
        existing.asIngredient = true;
        if (!existing.name) {
          existing.name = col(row, "Ingredient variant name");
        }
      } else {
        bySku.set(ingredientSku, {
          name: col(row, "Ingredient variant name"),
          asParent: false,
          asIngredient: true,
        });
      }
    }
  }

  if (bySku.size === 0) {
    throw new Error(
      `No product SKUs in ${RECIPES_CSV}. Expected parent and/or SA-/ASM-/FIN-/CUT- ingredient columns.`,
    );
  }

  const products: ProductReq[] = [...bySku.entries()]
    .map(([sku, meta]) => {
      let role: SkuRole = "parent";
      if (meta.asParent && meta.asIngredient) role = "both";
      else if (meta.asIngredient && !meta.asParent) role = "ingredient";
      else role = "parent";
      return { sku, name: meta.name, role };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const parentCount = products.filter(
    (p) => p.role === "parent" || p.role === "both",
  ).length;
  const ingredientShellCount = products.filter(
    (p) => p.role === "ingredient" || p.role === "both",
  ).length;
  const ingredientOnlyCount = products.filter(
    (p) => p.role === "ingredient",
  ).length;

  return {
    products,
    parentCount,
    ingredientShellCount,
    ingredientOnlyCount,
  };
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function prefixCounts(skus: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const sku of skus) {
    const p = prefixOf(sku);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}${n}`)
    .join(" ");
}

async function main(): Promise<void> {
  const {
    products,
    parentCount,
    ingredientShellCount,
    ingredientOnlyCount,
  } = loadProductRequirements();

  console.log("Katana Phase C — post missing product shells");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log(`  source: ${RECIPES_CSV}`);
  console.log(`  unified product SKUs: ${products.length}`);
  console.log(`    parents (Product col):           ${parentCount}`);
  console.log(`    ingredient shells (SA/ASM/…):    ${ingredientShellCount}`);
  console.log(`    ingredient-only (never parent):  ${ingredientOnlyCount}`);
  console.log(
    "  POST /products { is_producible:true, is_purchasable:false, is_sellable per FIN-/ASM-/SA-/CUT- }",
  );
  console.log("  note: Katana field is is_producible (not is_manufactured)");
  console.log("");

  console.log("→ Loading /variants");
  const variants = await paginate<KatanaVariant>(
    "/variants?include_deleted=false",
    "variants",
  );

  const bySku = new Map<string, KatanaVariant[]>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(v.sku ?? "");
    if (!sku || !Number.isFinite(v.id)) continue;
    const list = bySku.get(sku) ?? [];
    list.push(v);
    bySku.set(sku, list);
  }

  const missing: ProductReq[] = [];
  const already: PlanRow[] = [];
  const blockedMaterial: PlanRow[] = [];

  for (const req of products) {
    const hits = bySku.get(req.sku) ?? [];
    const isSellable = inferProductIsSellable(req.sku);

    if (hits.length === 0) {
      missing.push(req);
      continue;
    }

    const asProduct = hits.find(
      (h) => h.product_id != null && Number.isFinite(Number(h.product_id)),
    );
    const asMaterial = hits.find(
      (h) => h.material_id != null && Number.isFinite(Number(h.material_id)),
    );

    if (asProduct) {
      already.push({
        action: "already_present",
        sku: req.sku,
        name: req.name,
        role: req.role,
        is_sellable: isSellable,
        is_producible: true,
        product_id: String(asProduct.product_id),
        variant_id: String(asProduct.id),
        status: "ok",
      });
      continue;
    }

    if (asMaterial) {
      blockedMaterial.push({
        action: "blocked_as_material",
        sku: req.sku,
        name: req.name,
        role: req.role,
        is_sellable: isSellable,
        is_producible: true,
        product_id: "",
        variant_id: String(asMaterial.id),
        status: `SKU exists as material #${asMaterial.material_id} — cannot POST /products`,
      });
      continue;
    }

    missing.push(req);
  }

  const work = limit != null ? missing.slice(0, limit) : missing;
  const plan: PlanRow[] = [...already, ...blockedMaterial];

  const missingIngredientOnly = missing.filter((m) => m.role === "ingredient");

  console.log("");
  console.log(
    `→ ${dryRun ? "Would post" : "Posting"} ${work.length} products` +
      (limit != null ? ` (limit=${limit}, missing=${missing.length})` : ""),
  );
  console.log(`  already present: ${already.length}`);
  console.log(`  blocked as material: ${blockedMaterial.length}`);
  console.log(`  missing prefixes: ${prefixCounts(missing.map((m) => m.sku))}`);
  console.log(
    `  missing ingredient-only: ${missingIngredientOnly.length}`,
  );

  for (const req of work) {
    const isSellable = inferProductIsSellable(req.sku);
    const name = req.name.trim() || req.sku;

    if (dryRun) {
      plan.push({
        action: "would_post",
        sku: req.sku,
        name,
        role: req.role,
        is_sellable: isSellable,
        is_producible: true,
        product_id: "",
        variant_id: "",
        status: "dry_run",
      });
      continue;
    }

    try {
      const { data } = await katanaFetch<Record<string, unknown>>("/products", {
        method: "POST",
        body: {
          name,
          uom: "pcs",
          is_sellable: isSellable,
          is_producible: true,
          is_purchasable: false,
          variants: [{ sku: req.sku }],
        },
      });
      await delay(REQUEST_DELAY_MS);

      const productId = Number(data.id);
      const variantsOut = Array.isArray(data.variants) ? data.variants : [];
      const first = variantsOut[0] as Record<string, unknown> | undefined;
      const variantId = first ? Number(first.id) : NaN;

      plan.push({
        action: "posted",
        sku: req.sku,
        name,
        role: req.role,
        is_sellable: isSellable,
        is_producible: true,
        product_id: Number.isFinite(productId) ? String(productId) : "",
        variant_id: Number.isFinite(variantId) ? String(variantId) : "",
        status: "ok",
      });
      console.log(
        `  posted ${req.sku} product=#${productId} variant=#${variantId} sellable=${isSellable} role=${req.role}`,
      );
    } catch (e) {
      const detail =
        e instanceof KatanaApiError
          ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
          : e instanceof Error
            ? e.message
            : String(e);
      plan.push({
        action: "failed",
        sku: req.sku,
        name,
        role: req.role,
        is_sellable: isSellable,
        is_producible: true,
        product_id: "",
        variant_id: "",
        status: detail.slice(0, 500),
      });
      console.warn(`  failed ${req.sku}: ${detail}`);
      await delay(REQUEST_DELAY_MS);
    }
  }

  plan.sort((a, b) => a.sku.localeCompare(b.sku));

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(
    outDir,
    `katana-post-missing-products-plan-${stamp}.csv`,
  );

  writeCsv(
    planPath,
    [
      "action",
      "sku",
      "name",
      "role",
      "is_sellable",
      "is_producible",
      "product_id",
      "variant_id",
      "status",
    ],
    plan.map((r) => [
      r.action,
      r.sku,
      r.name,
      r.role,
      String(r.is_sellable),
      String(r.is_producible),
      r.product_id,
      r.variant_id,
      r.status,
    ]),
  );

  const counts = (action: PlanAction) =>
    plan.filter((r) => r.action === action).length;
  const wouldPostIngredientOnly = plan.filter(
    (r) => r.action === "would_post" && r.role === "ingredient",
  ).length;

  console.log("");
  console.log("Summary");
  console.log(`  unified CSV shells:     ${products.length}`);
  console.log(`  missing (gap):          ${missing.length}`);
  console.log(`    ingredient-only:      ${missingIngredientOnly.length}`);
  console.log(`  work rows:              ${work.length}`);
  console.log(`  would_post:             ${counts("would_post")}`);
  console.log(`    of which ingredient:  ${wouldPostIngredientOnly}`);
  console.log(`  posted:                 ${counts("posted")}`);
  console.log(`  already_present:        ${counts("already_present")}`);
  console.log(`  blocked_as_material:    ${counts("blocked_as_material")}`);
  console.log(`  failed:                 ${counts("failed")}`);
  console.log(`  report: ${planPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to POST /products.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
