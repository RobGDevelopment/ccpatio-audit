/**
 * Commit eleven legacy uncut fabric reservations as manufacturing-order
 * recipe rows. One sales order and one make-to-order MO per legacy order
 * number. Order 1762 carries Shelter Surf and Snow Cap on the same MO.
 * Snow Cap's two bins (4 + 5) are one 9-yard ingredient.
 *
 * Spectrum Carbon's live variant is FAB-SPEC-CARB. FAB-SPE-CAR does not exist
 * and is never created.
 *
 * Dry-run is the default. --confirm is the only flag that writes.
 *
 *   npx tsx scripts/ops/inject-legacy-wip.ts
 *   npx tsx scripts/ops/inject-legacy-wip.ts --confirm
 *
 * Auth: KATANA_API_TOKEN, or the repo's KATANA_PERSONAL_ACCESS_TOKEN /
 * KATANA_API_KEY. Base URL is https://api.katanamrp.com/v1 unless
 * KATANA_API_BASE is set.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KatanaApiError,
  createIntervalPacer,
  findVariantBySku,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { CC_MANUFACTURING_LOCATION_ID } from "../../src/server/ghl/hold-order";
import { unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

if (!process.env.KATANA_PERSONAL_ACCESS_TOKEN?.trim() && process.env.KATANA_API_TOKEN?.trim()) {
  process.env.KATANA_PERSONAL_ACCESS_TOKEN = process.env.KATANA_API_TOKEN.trim();
}

const SHELL_SKU = "FIN-WIP-SHEET";
const SHELL_NAME = "Sheet migration custom build";
const CUSTOMER_NAME = "Legacy WIP commitment";
const GENERIC_SKU = "RM-FAB-GENERIC";
const LEDGER_PATH = join(process.cwd(), "data_migration", "reports", "legacy-wip-inject.json");

type Line = {
  legacyOrder: string;
  sku: string;
  name: string;
  yards: number;
  /** Present when the requested code is not the live Katana variant. */
  requestedSku?: string;
};

/**
 * Yardage is the uncut reservation (YARDAS RESERV.), not the negative
 * STOCK AVAILABLE figure. Snow Cap 4 and 5 are already combined.
 */
const LINES: readonly Line[] = [
  { legacyOrder: "1796", sku: "FAB-MID-IND", name: "MIDORI INDIGO", yards: 28 },
  { legacyOrder: "1749", sku: "FAB-PLA-MOC", name: "PLAY MOCHA", yards: 24 },
  { legacyOrder: "1791", sku: "FAB-PRE-FAW", name: "PRECISE FAWN", yards: 26 },
  { legacyOrder: "1491", sku: "FAB-REV-IND", name: "REVIVE INDIGO", yards: 40 },
  { legacyOrder: "1762", sku: "FAB-SHE-SUR", name: "SHELTER SURF", yards: 9 },
  { legacyOrder: "1787", sku: "FAB-SHE-WHI", name: "SHELTER WHITE", yards: 18 },
  { legacyOrder: "1762", sku: "FAB-SNO-CAP", name: "SNOW CAP", yards: 9 },
  {
    legacyOrder: "1786",
    sku: "FAB-SPEC-CARB",
    requestedSku: "FAB-SPE-CAR",
    name: "SPECTRUM CARBON",
    yards: 2,
  },
  { legacyOrder: "1784", sku: "FAB-TRU-FOG", name: "TRUSTED FOG", yards: 42 },
  { legacyOrder: "1675", sku: "FAB-VAL-SED", name: "VALLEY SEDONA", yards: 14 },
];

type ResolvedLine = Line & { variantId: number };
type OrderPlan = {
  legacyOrder: string;
  orderNo: string;
  lines: ResolvedLine[];
  additionalInfo: string;
};

function orderNo(legacyOrder: string): string {
  return `LEGACY-WIP-${legacyOrder}`;
}

function recipeToken(legacyOrder: string, sku: string): string {
  return `legacy-wip:${legacyOrder}:${sku}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function groupLines(lines: readonly ResolvedLine[]): OrderPlan[] {
  const byOrder = new Map<string, ResolvedLine[]>();
  for (const line of lines) {
    const bucket = byOrder.get(line.legacyOrder) ?? [];
    bucket.push(line);
    byOrder.set(line.legacyOrder, bucket);
  }
  return [...byOrder.entries()].map(([legacyOrder, orderLines]) => ({
    legacyOrder,
    orderNo: orderNo(legacyOrder),
    lines: orderLines,
    additionalInfo: [
      "Legacy uncut fabric commitment from the allocate sheet.",
      `Legacy order ${legacyOrder}.`,
      ...orderLines.map((line) => `${line.name} ${line.sku} ${line.yards} yd`),
      "No foam, metal, or Dekton on this manufacturing order.",
    ].join(" "),
  }));
}

function salesOrderRowIds(data: Record<string, unknown>): number[] {
  const rows = data.sales_order_rows;
  if (!Array.isArray(rows)) return [];
  const ids: number[] = [];
  for (const row of rows) {
    const id = Number(asRecord(row)?.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}

async function findExistingSalesOrder(number: string): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/sales_orders?order_no=${encodeURIComponent(number)}&limit=50`,
  );
  return (
    unwrapList<Record<string, unknown>>(data).find((row) => String(row.order_no ?? "") === number) ??
    null
  );
}

async function ensureCustomer(confirm: boolean): Promise<number | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await katanaFetch(`/customers?limit=50&page=${page}`);
    const rows = unwrapList<Record<string, unknown>>(data);
    const hit = rows.find((row) => String(row.name ?? "").trim() === CUSTOMER_NAME);
    if (hit && Number(hit.id) > 0) return Number(hit.id);
    if (rows.length < 50) break;
  }
  if (!confirm) return null;
  const { data } = await katanaFetch<Record<string, unknown>>("/customers", {
    method: "POST",
    idempotencyKey: "legacy-wip-customer",
    body: { name: CUSTOMER_NAME, currency: "USD" },
  });
  const id = Number(data.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Katana created customer "${CUSTOMER_NAME}" without an id.`);
  }
  return id;
}

async function ensureShell(confirm: boolean): Promise<{ variantId: number; created: boolean } | null> {
  const existing = await findVariantBySku(SHELL_SKU);
  if (existing?.product_id) return { variantId: existing.id, created: false };
  if (!confirm) return null;
  const { data } = await katanaFetch<Record<string, unknown>>("/products", {
    method: "POST",
    idempotencyKey: "legacy-wip-shell:FIN-WIP-SHEET",
    body: {
      name: SHELL_NAME,
      uom: "pcs",
      category_name: "Finished goods",
      additional_info:
        "Migration shell for legacy sheet commitments. Fabric yards live on the manufacturing order.",
      is_sellable: true,
      is_producible: true,
      is_purchasable: false,
      variants: [{ sku: SHELL_SKU }],
    },
  });
  const variant = asRecord(Array.isArray(data.variants) ? data.variants[0] : null);
  const variantId = Number(variant?.id);
  if (!Number.isFinite(variantId) || variantId <= 0) {
    throw new Error("Katana created FIN-WIP-SHEET without a variant id.");
  }
  return { variantId, created: true };
}

async function listRecipeRows(
  manufacturingOrderId: number,
): Promise<Array<{ id: number; notes: string; variantId: number }>> {
  const rows: Array<{ id: number; notes: string; variantId: number }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await katanaFetch(
      `/manufacturing_order_recipe_rows?manufacturing_order_id=${manufacturingOrderId}&limit=50&page=${page}`,
    );
    const pageRows = unwrapList<Record<string, unknown>>(data);
    for (const row of pageRows) {
      const id = Number(row.id);
      if (Number.isFinite(id)) {
        rows.push({
          id,
          notes: typeof row.notes === "string" ? row.notes : "",
          variantId: Number(row.variant_id),
        });
      }
    }
    if (pageRows.length < 50) break;
  }
  return rows;
}

async function findManufacturingOrder(
  salesOrderId: number,
  salesOrderRowId: number,
): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=50`,
  );
  return (
    unwrapList<Record<string, unknown>>(data).find(
      (row) => Number(row.sales_order_row_id) === salesOrderRowId,
    ) ?? null
  );
}

async function createManufacturingOrder(salesOrderRowId: number, legacyOrder: string): Promise<number> {
  const post = () =>
    katanaFetch<Record<string, unknown>>("/manufacturing_order_make_to_order", {
      method: "POST",
      idempotencyKey: `legacy-wip-mo-${legacyOrder}`,
      body: { sales_order_row_id: salesOrderRowId, create_subassemblies: false },
    });

  try {
    const { data } = await post();
    const id = Number(data.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Make-to-order for ${orderNo(legacyOrder)} returned no id.`);
    }
    return id;
  } catch (error: unknown) {
    if (!(error instanceof KatanaApiError) || error.status !== 422) throw error;
    const generic = await findVariantBySku(GENERIC_SKU);
    const shell = await findVariantBySku(SHELL_SKU);
    if (!generic || !shell?.product_id) throw error;
    await katanaFetch("/recipes", {
      method: "POST",
      idempotencyKey: "legacy-wip-shell-placeholder",
      body: {
        keep_current_rows: true,
        rows: [
          {
            product_variant_id: shell.id,
            ingredient_variant_id: generic.id,
            quantity: 1,
            notes: "Legacy WIP shell placeholder. Removed from each manufacturing order after the fabric row posts.",
          },
        ],
      },
    });
    const { data } = await post();
    const id = Number(data.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Make-to-order for ${orderNo(legacyOrder)} returned no id after the shell placeholder.`);
    }
    return id;
  }
}

async function labelManufacturingOrder(
  manufacturingOrderId: number,
  number: string,
  additionalInfo: string,
): Promise<string | null> {
  try {
    const { data } = await katanaFetch<Record<string, unknown>>(
      `/manufacturing_orders/${manufacturingOrderId}`,
      { method: "PATCH", body: { order_no: number, additional_info: additionalInfo } },
    );
    return typeof data.order_no === "string" ? data.order_no : number;
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 422) return null;
    throw error;
  }
}

async function resolveLines(): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = [];
  const missing: string[] = [];
  for (const line of LINES) {
    const variant = await findVariantBySku(line.sku);
    if (!variant || variant.type === "product") {
      missing.push(line.sku);
      continue;
    }
    resolved.push({ ...line, variantId: variant.id });
  }
  if (missing.length > 0) {
    throw new Error(
      `Refusing to continue. These fabric variants are missing in Katana: ${missing.join(", ")}. Nothing was created.`,
    );
  }
  return resolved;
}

function printPlan(plans: OrderPlan[], shell: { variantId: number; created: boolean } | null): void {
  console.log(`mode: dry-run`);
  console.log(`api: live Katana unless KATANA_API_BASE is set`);
  console.log(`customer: ${CUSTOMER_NAME}`);
  console.log(
    shell
      ? `shell: ${SHELL_SKU} variant ${shell.variantId}`
      : `shell: ${SHELL_SKU} is missing and would be created`,
  );
  for (const plan of plans) {
    const salesOrderBody = {
      order_no: plan.orderNo,
      location_id: CC_MANUFACTURING_LOCATION_ID,
      currency: "USD",
      customer_ref: plan.legacyOrder,
      additional_info: plan.additionalInfo,
      sales_order_rows: [
        {
          variant_id: shell?.variantId ?? `<${SHELL_SKU}>`,
          quantity: 1,
          price_per_unit: 0,
        },
      ],
    };
    console.log(`\n${plan.orderNo}`);
    console.log("POST /sales_orders");
    console.log(JSON.stringify(salesOrderBody, null, 2));
    console.log("POST /manufacturing_order_make_to_order");
    console.log(
      JSON.stringify({ sales_order_row_id: "<row created above>", create_subassemblies: false }, null, 2),
    );
    console.log(`PATCH /manufacturing_orders/<id>  order_no=${plan.orderNo}`);
    for (const line of plan.lines) {
      const alias = line.requestedSku ? ` (requested ${line.requestedSku}, live sku ${line.sku})` : "";
      console.log(`POST /manufacturing_order_recipe_rows${alias}`);
      console.log(
        JSON.stringify(
          {
            manufacturing_order_id: "<mo created above>",
            variant_id: line.variantId,
            planned_quantity_per_unit: line.yards,
            notes: recipeToken(plan.legacyOrder, line.sku) + " " + line.name,
          },
          null,
          2,
        ),
      );
    }
  }
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const dryFlag = process.argv.includes("--dry-run");
  if (confirm && dryFlag) {
    throw new Error("Pass either --confirm or --dry-run, not both.");
  }
  setKatanaRequestPacer(createIntervalPacer(1100));

  const resolved = await resolveLines();
  const plans = groupLines(resolved);
  const yards = resolved.reduce((sum, line) => sum + line.yards, 0);
  console.log(
    `${resolved.length} fabric rows, ${plans.length} manufacturing orders, ${yards} yards.`,
  );
  for (const line of resolved) {
    if (line.requestedSku) {
      console.log(`${line.requestedSku} is not a Katana variant. Using ${line.sku} for ${line.name}.`);
    }
  }

  if (!confirm) {
    const shell = await ensureShell(false);
    printPlan(plans, shell);
    console.log("\nDry-run only. No sales orders, manufacturing orders, or recipe rows were written.");
    console.log("Re-run with --confirm to write these documents to Katana.");
    return;
  }

  const shell = await ensureShell(true);
  if (!shell) throw new Error(`${SHELL_SKU} could not be resolved.`);
  const customerId = await ensureCustomer(true);
  if (!customerId) throw new Error(`Customer "${CUSTOMER_NAME}" could not be resolved.`);

  const generic = await findVariantBySku(GENERIC_SKU);
  const ledger: Array<Record<string, unknown>> = [];

  for (const plan of plans) {
    let salesOrder = await findExistingSalesOrder(plan.orderNo);
    let salesOrderId = Number(salesOrder?.id);
    if (!salesOrder) {
      const { data } = await katanaFetch<Record<string, unknown>>("/sales_orders", {
        method: "POST",
        idempotencyKey: `legacy-wip-so-${plan.legacyOrder}`,
        body: {
          order_no: plan.orderNo,
          customer_id: customerId,
          location_id: CC_MANUFACTURING_LOCATION_ID,
          currency: "USD",
          customer_ref: plan.legacyOrder,
          additional_info: plan.additionalInfo,
          sales_order_rows: [{ variant_id: shell.variantId, quantity: 1, price_per_unit: 0 }],
        },
      });
      salesOrder = data;
      salesOrderId = Number(data.id);
    }
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
      throw new Error(`${plan.orderNo} sales order has no id.`);
    }

    let rowIds = salesOrderRowIds(salesOrder);
    if (rowIds.length === 0) {
      const fetched = await katanaFetch<Record<string, unknown>>(`/sales_orders/${salesOrderId}`);
      rowIds = salesOrderRowIds(asRecord(fetched.data) ?? {});
    }
    if (rowIds.length !== 1) {
      throw new Error(`${plan.orderNo} has ${rowIds.length} sales-order rows; expected 1.`);
    }
    const salesOrderRowId = rowIds[0]!;

    let manufacturingOrder = await findManufacturingOrder(salesOrderId, salesOrderRowId);
    let manufacturingOrderId = Number(manufacturingOrder?.id);
    if (!manufacturingOrderId) {
      manufacturingOrderId = await createManufacturingOrder(salesOrderRowId, plan.legacyOrder);
    }
    const labeled = await labelManufacturingOrder(
      manufacturingOrderId,
      plan.orderNo,
      plan.additionalInfo,
    );
    console.log(
      `${plan.orderNo} sales order ${salesOrderId} manufacturing order ${manufacturingOrderId}` +
        (labeled ? ` labeled ${labeled}` : " (order number left as Katana assigned it)"),
    );

    const existingRecipes = await listRecipeRows(manufacturingOrderId);
    const recipeIds: number[] = [];
    for (const line of plan.lines) {
      const token = recipeToken(plan.legacyOrder, line.sku);
      const already = existingRecipes.find((row) => row.notes.includes(token));
      if (already) {
        recipeIds.push(already.id);
        console.log(`  skip ${line.sku} ${line.yards} yd (already on the MO)`);
        continue;
      }
      const { data } = await katanaFetch<Record<string, unknown>>("/manufacturing_order_recipe_rows", {
        method: "POST",
        idempotencyKey: token,
        body: {
          manufacturing_order_id: manufacturingOrderId,
          variant_id: line.variantId,
          planned_quantity_per_unit: line.yards,
          notes: `${token} ${line.name}`.slice(0, 500),
        },
      });
      const id = Number(data.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(`${plan.orderNo} ${line.sku} recipe row returned no id.`);
      }
      recipeIds.push(id);
      console.log(`  committed ${line.sku} ${line.yards} yd recipe ${id}`);
    }

    if (generic) {
      for (const row of existingRecipes) {
        if (row.variantId === generic.id && !row.notes.startsWith("legacy-wip:")) {
          await katanaFetch(`/manufacturing_order_recipe_rows/${row.id}`, { method: "DELETE" });
          console.log(`  removed placeholder ingredient ${row.id}`);
        }
      }
    }

    ledger.push({
      legacyOrder: plan.legacyOrder,
      orderNo: plan.orderNo,
      salesOrderId,
      manufacturingOrderId,
      manufacturingOrderNo: labeled,
      recipeRowIds: recipeIds,
      lines: plan.lines.map((line) => ({ sku: line.sku, yards: line.yards, variantId: line.variantId })),
    });
  }

  mkdirSync(join(process.cwd(), "data_migration", "reports"), { recursive: true });
  writeFileSync(
    LEDGER_PATH,
    JSON.stringify({ writtenAt: new Date().toISOString(), orders: ledger }, null, 2),
  );
  console.log(`Wrote ${LEDGER_PATH}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
