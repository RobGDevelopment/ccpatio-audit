/**
 * Create third-party Katana products from the three showroom CSVs.
 *
 * One product per short title. Each sheet row is a variant whose
 * config attribute `Spec` is the label the showroom card prints.
 * On-hand is an absolute quantity at CC Manufacturing (98179): the
 * posted stock adjustment is target minus current, and a matching
 * count posts nothing.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-3rd-party-inventory.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-3rd-party-inventory.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { readSpecLabel } from "../../src/lib/stock-display";
import { CC_MANUFACTURING_LOCATION_ID } from "../../src/server/ghl/hold-order";
import {
  groupThirdPartyProducts,
  loadThirdPartyLines,
  type ThirdPartyLine,
  type ThirdPartyProduct,
} from "./lib/third-party-inventory";
import { unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const ADJUSTMENT_BATCH = 40;

setKatanaRequestPacer(createIntervalPacer(350));

type KnownVariant = {
  id: number;
  sku: string;
  productId: number | null;
  materialId: number | null;
  spec: string | null;
  attributes: unknown;
};

type ProductShell = {
  id: number;
  name: string;
  category: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function katanaError(error: unknown): string {
  if (error instanceof KatanaApiError) {
    const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
    return `${error.message}${details}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function paginate(path: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(`${path}${sep}limit=${PAGE_SIZE}&page=${page}`);
    const pageRows = unwrapList<Record<string, unknown>>(data);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  throw new Error(`${path} did not finish within ${MAX_PAGES} pages.`);
}

function variantFrom(record: Record<string, unknown>): KnownVariant | null {
  if (record.deleted_at) return null;
  const id = Number(record.id);
  const sku = String(record.sku ?? "").trim().toUpperCase();
  if (!Number.isFinite(id) || id <= 0 || !sku) return null;
  const productId = Number(record.product_id);
  const materialId = Number(record.material_id);
  return {
    id,
    sku,
    productId: Number.isFinite(productId) && productId > 0 ? productId : null,
    materialId: Number.isFinite(materialId) && materialId > 0 ? materialId : null,
    spec: readSpecLabel(record.config_attributes),
    attributes: record.config_attributes ?? [],
  };
}

async function loadCatalog(): Promise<{
  variants: Map<string, KnownVariant>;
  products: Map<string, ProductShell>;
}> {
  const products = new Map<string, ProductShell>();
  const variants = new Map<string, KnownVariant>();
  for (const product of await paginate("/products")) {
    if (product.deleted_at) continue;
    const id = Number(product.id);
    const name = String(product.name ?? "").trim();
    const category = String(product.category_name ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    const key = `${category.toLowerCase()}::${name.toLowerCase()}`;
    if (!products.has(key)) products.set(key, { id, name, category });
    const nested = Array.isArray(product.variants) ? product.variants : [];
    for (const variant of nested) {
      const record = asRecord(variant);
      const known = record ? variantFrom(record) : null;
      if (known) variants.set(known.sku, known);
    }
  }
  for (const variant of await paginate("/variants")) {
    const known = variantFrom(variant);
    if (known && !variants.has(known.sku)) variants.set(known.sku, known);
  }
  return { variants, products };
}

function specAttributes(existing: unknown, spec: string): Array<{ config_name: string; config_value: string }> {
  const kept: Array<{ config_name: string; config_value: string }> = [];
  if (Array.isArray(existing)) {
    for (const attribute of existing) {
      const record = asRecord(attribute);
      if (!record) continue;
      const name = String(record.config_name ?? record.name ?? record.key ?? "").trim();
      const value = String(record.config_value ?? record.value ?? "").trim();
      if (!name || !value || name.toLowerCase() === "spec") continue;
      kept.push({ config_name: name, config_value: value });
    }
  }
  kept.push({ config_name: "Spec", config_value: spec });
  return kept;
}

function variantBody(line: ThirdPartyLine): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sku: line.sku,
    sales_price: 0,
  };
  if (line.spec) {
    body.config_attributes = [{ config_name: "Spec", config_value: line.spec }];
  }
  return body;
}

function rememberCreated(
  variants: Map<string, KnownVariant>,
  data: Record<string, unknown>,
  productId: number,
): void {
  const rows = Array.isArray(data.variants) ? data.variants : [data];
  for (const row of rows) {
    const record = asRecord(row);
    const known = record ? variantFrom(record) : null;
    if (!known) continue;
    variants.set(known.sku, { ...known, productId: known.productId ?? productId });
  }
}

async function createProduct(
  group: ThirdPartyProduct,
  variants: Map<string, KnownVariant>,
): Promise<void> {
  const specValues = [...new Set(group.lines.map((line) => line.spec).filter(Boolean))];
  const body = {
    name: group.productName,
    uom: "pcs",
    category_name: group.category,
    is_sellable: true,
    is_producible: false,
    is_purchasable: true,
    additional_info: "Third-party showroom item. Variant differences are the Spec attribute.",
    ...(specValues.length > 0
      ? { configs: [{ name: "Spec", values: specValues }] }
      : {}),
    variants: group.lines.map(variantBody),
  };
  console.log(
    `  POST /products ${group.category} / ${group.productName} (${group.lines.length} variants)`,
  );
  if (!confirm) return;
  const { data } = await katanaFetch<Record<string, unknown>>("/products", {
    method: "POST",
    body,
  });
  const productId = Number(data.id);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Error(`Katana created ${group.productName} without a product id.`);
  }
  rememberCreated(variants, data, productId);
  const missing = group.lines.filter((line) => !variants.has(line.sku));
  if (missing.length > 0) {
    const fetched = await katanaFetch<Record<string, unknown>>(`/products/${productId}`);
    rememberCreated(variants, fetched.data, productId);
  }
  const stillMissing = group.lines.filter((line) => !variants.has(line.sku));
  if (stillMissing.length > 0) {
    throw new Error(
      `${group.productName} is missing SKUs after create: ${stillMissing.map((line) => line.sku).join(", ")}`,
    );
  }
}

async function createVariant(
  productId: number,
  line: ThirdPartyLine,
  variants: Map<string, KnownVariant>,
): Promise<void> {
  console.log(`  POST /variants ${line.sku} on product ${productId}`);
  if (!confirm) return;
  const { data } = await katanaFetch<Record<string, unknown>>("/variants", {
    method: "POST",
    body: {
      product_id: productId,
      ...variantBody(line),
    },
  });
  rememberCreated(variants, data, productId);
  if (!variants.has(line.sku)) {
    throw new Error(`Katana did not return variant ${line.sku}.`);
  }
}

async function ensureSpec(known: KnownVariant, line: ThirdPartyLine): Promise<void> {
  if ((known.spec ?? "") === line.spec) return;
  if (!line.spec) return;
  console.log(`  PATCH Spec ${line.sku}: ${known.spec ?? "(none)"} → ${line.spec}`);
  if (!confirm) return;
  await katanaFetch(`/variants/${known.id}`, {
    method: "PATCH",
    body: { config_attributes: specAttributes(known.attributes, line.spec) },
  });
  known.spec = line.spec;
}

async function ensureGroup(
  group: ThirdPartyProduct,
  variants: Map<string, KnownVariant>,
  products: Map<string, ProductShell>,
): Promise<void> {
  const known = group.lines.map((line) => variants.get(line.sku) ?? null);
  for (const hit of known) {
    if (hit?.materialId) {
      throw new Error(`${hit.sku} already exists as a Katana material.`);
    }
  }
  const productIds = [
    ...new Set(known.flatMap((hit) => (hit?.productId ? [hit.productId] : []))),
  ];
  if (productIds.length > 1) {
    throw new Error(
      `${group.productName} variants are split across Katana products ${productIds.join(", ")}.`,
    );
  }

  const shellKey = `${group.category.toLowerCase()}::${group.productName.toLowerCase()}`;
  const shell = products.get(shellKey) ?? null;
  let productId = productIds[0] ?? shell?.id ?? null;

  if (!productId) {
    await createProduct(group, variants);
    return;
  }

  if (productIds.length === 0 && shell) {
    console.log(
      `  attach ${group.lines.length} variants to existing ${group.category} / ${group.productName} (${shell.id})`,
    );
  }

  for (let index = 0; index < group.lines.length; index += 1) {
    const line = group.lines[index]!;
    const hit = variants.get(line.sku) ?? null;
    if (!hit) {
      await createVariant(productId, line, variants);
      continue;
    }
    if (hit.productId && hit.productId !== productId) {
      throw new Error(`${line.sku} is on product ${hit.productId}, not ${productId}.`);
    }
    await ensureSpec(hit, line);
  }
}

async function onHandAtFactory(variantIds: number[]): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  for (let index = 0; index < variantIds.length; index += 40) {
    const chunk = variantIds.slice(index, index + 40);
    const params = new URLSearchParams();
    params.set("limit", "250");
    for (const id of chunk) params.append("variant_id", String(id));
    const { data } = await katanaFetch(`/inventory?${params.toString()}`);
    for (const row of unwrapList<Record<string, unknown>>(data)) {
      if (Number(row.location_id) !== CC_MANUFACTURING_LOCATION_ID) continue;
      const variantId = Number(row.variant_id);
      if (!Number.isFinite(variantId)) continue;
      const current = totals.get(variantId) ?? 0;
      totals.set(variantId, roundQty(current + Number(row.quantity_in_stock ?? 0)));
    }
  }
  return totals;
}

async function postDeltas(
  rows: Array<{ sku: string; variantId: number; delta: number; target: number; current: number }>,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < rows.length; index += ADJUSTMENT_BATCH) {
    const chunk = rows.slice(index, index + ADJUSTMENT_BATCH);
    const payload = {
      location_id: CC_MANUFACTURING_LOCATION_ID,
      stock_adjustment_date: today,
      reason: "3rd-party opening balance",
      additional_info: `ops:import-3rd-party-inventory ${index / ADJUSTMENT_BATCH + 1}`,
      stock_adjustment_rows: chunk.map((row) => ({
        variant_id: row.variantId,
        quantity: row.delta,
      })),
    };
    console.log(
      `  stock delta location ${CC_MANUFACTURING_LOCATION_ID} rows=${chunk.length} ` +
        chunk.map((row) => `${row.sku} ${row.current}→${row.target}`).join(", "),
    );
    if (!confirm) continue;
    const { data } = await katanaFetch<{ id?: number }>("/stock_adjustments", {
      method: "POST",
      body: payload,
    });
    console.log(`  POSTED stock_adjustment id=${data.id ?? "?"}`);
  }
}

async function main(): Promise<void> {
  const lines = loadThirdPartyLines();
  const groups = groupThirdPartyProducts(lines);
  console.log("Third-party inventory import");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  location: ${CC_MANUFACTURING_LOCATION_ID}`);
  console.log(`  lines: ${lines.length}`);
  console.log(`  products: ${groups.length}`);

  const catalog = await loadCatalog();
  console.log(`  katana variants indexed: ${catalog.variants.size}`);

  for (const group of groups) {
    await ensureGroup(group, catalog.variants, catalog.products);
  }

  const stockRows: Array<{
    sku: string;
    variantId: number;
    delta: number;
    target: number;
    current: number;
  }> = [];
  let unchanged = 0;
  let unresolved = 0;
  const ids: number[] = [];
  for (const line of lines) {
    const known = catalog.variants.get(line.sku);
    if (known) ids.push(known.id);
  }
  const onHand = confirm || ids.length > 0 ? await onHandAtFactory(ids) : new Map<number, number>();

  for (const line of lines) {
    const known = catalog.variants.get(line.sku);
    if (!known) {
      unresolved += 1;
      console.log(`  no variant yet for ${line.sku} (dry-run create). target on-hand ${line.onHand}`);
      if (line.onHand !== 0) {
        stockRows.push({
          sku: line.sku,
          variantId: 0,
          delta: line.onHand,
          target: line.onHand,
          current: 0,
        });
      }
      continue;
    }
    const current = onHand.get(known.id) ?? 0;
    const delta = roundQty(line.onHand - current);
    if (Math.abs(delta) < 0.00005) {
      unchanged += 1;
      continue;
    }
    stockRows.push({
      sku: line.sku,
      variantId: known.id,
      delta,
      target: line.onHand,
      current,
    });
  }

  const postable = stockRows.filter((row) => row.variantId > 0);
  console.log(
    `  stock unchanged: ${unchanged}; deltas: ${stockRows.length}; unresolved SKUs: ${unresolved}`,
  );
  if (!confirm && unresolved > 0) {
    console.log("  Dry-run does not create variants, so those deltas are the opening counts.");
  }
  if (confirm && unresolved > 0) {
    throw new Error(`${unresolved} SKUs still have no Katana variant, so stock was not fully posted.`);
  }
  await postDeltas(confirm ? postable : stockRows);

  console.log("\n=== Summary ===");
  console.log(`  sheet lines:     ${lines.length}`);
  console.log(`  master products: ${groups.length}`);
  console.log(`  stock deltas:    ${stockRows.length}`);
  console.log(`  already matched: ${unchanged}`);
  if (!confirm) console.log("  Re-run with --confirm to write Katana.");
}

main().catch((error: unknown) => {
  console.error(katanaError(error));
  process.exitCode = 1;
});
