/**
 * Live factory tracker → Katana sales orders, manufacturing orders,
 * operation rows, and fabric recipe rows.
 *
 * Scope: Standard Report status NEW and READY FOR DELIVERY only.
 * Shell: FIN-WIP-SHEET. Fabric yards are manufacturing-order recipe rows.
 * Does not create purchase orders, stock adjustments, invoices, or shipments.
 * Does not patch MIG-HOLD-FABRIC-20260811 unless --relieve-hold is combined
 * with --confirm. That flag stays off for the first live run.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --dry-run --order 1769
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --confirm --order 1769
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  LEGACY_RESOURCE_ALIASES,
  resolveKatanaOperationName,
  STANDARD_TRACKS,
  type KatanaResource,
} from "../../src/lib/factory-routing/resources";
import {
  KatanaApiError,
  createIntervalPacer,
  createMakeToOrderManufacturingOrders,
  findVariantBySku,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import {
  CC_MANUFACTURING_LOCATION_ID,
  FABRIC_HOLD_ORDER_ID,
  FABRIC_HOLD_ORDER_NO,
} from "../../src/server/ghl/hold-order";
import { nextHoldQuantity, roundYards } from "../../src/server/ghl/fabric-yardage";
import { col, parseQty, readCsvRecords, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const SHELL_SKU = "FIN-WIP-SHEET";
const SHELL_NAME = "Sheet migration custom build";
const HOLD_CUTOFF_UTC = Date.UTC(2026, 7, 11);
const REPORT_DIR = join(process.cwd(), "data_migration", "reports");
const DRY_RUN_PATH = join(REPORT_DIR, "wip-factory-import-dry-run.json");
const LEDGER_PATH = join(REPORT_DIR, "wip-factory-import.json");
const STANDARD_PATH = join(
  process.cwd(),
  "data_migration",
  "Standard Report 2026 CCPatio - NEW.csv",
);
const FABRIC_PATH = join(
  process.cwd(),
  "data_migration",
  "CURRENT Fabric Control Inventory 2026-CURRENT.xlsx - FABRIC NEEDS.csv",
);
const HUB_MAP_PATH = join(REPORT_DIR, "katana-bulk-update-materials.csv");

const MINTS = [
  {
    vendorSku: "47203-0003",
    name: "UNDERCURRENT LAGOON",
    proposedHubSku: "FAB-UND-LAG",
  },
  {
    vendorSku: "48081-0000",
    name: "SPECTRUM PEACOCK",
    proposedHubSku: "FAB-SPE-PEA",
  },
] as const;

type CellState = "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED" | "NOT_REQUIRED" | "BLANK" | "OTHER";
type OpStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
type Disposition = "recipe-row" | "skip" | "exception";

type HubEntry = { hubSku: string; name: string };

type VariantHit = {
  variantId: number;
  sku: string;
  name: string;
  materialId: number | null;
  productId: number | null;
};

type StockSnap = { inStock: number; committed: number; calculated: number };

type PlannedOp = {
  resource: KatanaResource;
  operationName: string;
  status: OpStatus;
  plannedTimeSeconds: number;
  resourceId: number | null;
};

type PlannedFabric = {
  vendorSku: string;
  hubSku: string | null;
  name: string;
  yards: number | null;
  sheetStatus: string;
  dateIntro: string;
  disposition: Disposition;
  dispositionReason: string;
  predictedAvailability: "NOT_AVAILABLE" | "IN_STOCK" | null;
  variantId: number | null;
  resolvedSku: string | null;
  mint: boolean;
  katana: StockSnap | null;
  sheetStock: number | null;
  sheetDifference: number | null;
  client: string;
  note: string;
  preFreeze: boolean;
};

type PlannedOrder = {
  legacyOrder: string;
  katanaOrderNo: string;
  customer: string;
  orderStatus: "NEW" | "READY FOR DELIVERY";
  type: string;
  additionalInfo: string;
  existingSalesOrderId: number | null;
  productionDeadline: string | null;
  moStatus: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  operations: PlannedOp[];
  fabrics: PlannedFabric[];
};

type GateBlock = { legacyOrder: string; vendorSku: string; reason: string };

type HoldOverlap = {
  legacyOrder: string;
  vendorSku: string;
  reason: string;
  yards: number | null;
  holdQuantity: number | null;
  dateIntro: string;
};

type LedgerOrder = {
  legacyOrder: string;
  katanaOrderNo: string;
  salesOrderId: number;
  salesOrderRowId: number;
  manufacturingOrderId: number;
  recipeRowIds: number[];
  operationRowIds: number[];
};

type Ledger = { updatedAt: string; orders: LedgerOrder[] };

const confirmRequested = process.argv.includes("--confirm");
const dryRunFlag = process.argv.includes("--dry-run");
const confirm = confirmRequested && !dryRunFlag;
const relieveHold = process.argv.includes("--relieve-hold") && confirm;
const orderFilter = readOrderFilter();

function readOrderFilter(): string | null {
  const inline = process.argv.find((arg) => arg.startsWith("--order="));
  if (inline) return inline.slice("--order=".length).trim() || null;
  const index = process.argv.indexOf("--order");
  const next = index >= 0 ? process.argv[index + 1] : undefined;
  if (next && !next.startsWith("--")) return next.trim();
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSheetDate(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

function cellState(raw: string): CellState {
  const value = raw.trim().toUpperCase();
  if (!value) return "BLANK";
  if (value === "COMPLETED") return "COMPLETED";
  if (value === "IN PROGRESS") return "IN_PROGRESS";
  if (value === "NOT STARTED") return "NOT_STARTED";
  if (value === "NOT REQUIRED") return "NOT_REQUIRED";
  return "OTHER";
}

function opStatus(state: CellState): OpStatus {
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "IN_PROGRESS") return "IN_PROGRESS";
  return "NOT_STARTED";
}

function trackSeconds(resource: KatanaResource): number {
  const steps = [
    ...STANDARD_TRACKS.aluminum_frame,
    ...STANDARD_TRACKS.cushion,
    ...STANDARD_TRACKS.dekton_top,
    ...STANDARD_TRACKS.final_assembly,
  ];
  const match =
    resource === "Quality Control" || resource === "Assembly & Packaging"
      ? STANDARD_TRACKS.final_assembly.find((step) => step.resource === resource)
      : steps.find((step) => step.resource === resource);
  const minutes = match?.runTimeMins ?? 0;
  return Math.round(minutes * 60);
}

function plannedOp(resource: KatanaResource, status: OpStatus): PlannedOp {
  return {
    resource,
    operationName: resolveKatanaOperationName(resource),
    status,
    plannedTimeSeconds: trackSeconds(resource),
    resourceId: null,
  };
}

function buildOperations(input: {
  orderStatus: "NEW" | "READY FOR DELIVERY";
  metal: CellState;
  powder: CellState;
  dekton: CellState;
  corte: CellState;
  sew: CellState;
  filling: CellState;
  cushions: CellState;
}): { operations: PlannedOp[]; moStatus: "NOT_STARTED" | "IN_PROGRESS" | "DONE" } {
  const operations: PlannedOp[] = [];

  if (input.metal !== "NOT_REQUIRED" && input.metal !== "OTHER") {
    const metalStatus = opStatus(input.metal);
    operations.push(plannedOp("Metal Cutting", metalStatus));
    operations.push(plannedOp("FAB POD A", metalStatus));
    const sandblast: OpStatus = input.metal === "COMPLETED" ? "COMPLETED" : "NOT_STARTED";
    operations.push(plannedOp("Sandblasting", sandblast));
  }

  if (input.powder !== "NOT_REQUIRED" && input.powder !== "OTHER") {
    const booth: OpStatus = input.powder === "COMPLETED" || input.powder === "IN_PROGRESS"
      ? opStatus(input.powder)
      : "NOT_STARTED";
    const oven: OpStatus = input.powder === "COMPLETED" ? "COMPLETED" : "NOT_STARTED";
    operations.push(plannedOp("Powder Coating Booth", booth));
    operations.push(plannedOp("Curing Oven", oven));
  }

  if (input.dekton !== "NOT_REQUIRED" && input.dekton !== "OTHER") {
    operations.push(plannedOp("Dekton Fabrication", opStatus(input.dekton)));
  }

  const granular = [input.corte, input.sew, input.filling];
  const granularBlank = granular.every((state) => state === "BLANK");
  const fan =
    granularBlank && input.cushions !== "BLANK" && input.cushions !== "NOT_REQUIRED" && input.cushions !== "OTHER";
  const corte = fan ? input.cushions : input.corte;
  const sew = fan ? input.cushions : input.sew;
  const filling = fan ? input.cushions : input.filling;
  const upholstery: Array<[KatanaResource, CellState]> = [
    ["Fabric Cutting", corte],
    ["Fabric Sewing", sew],
    ["Cushion Stuffing", filling],
  ];
  const groupActive = upholstery.some(
    ([, state]) => state === "COMPLETED" || state === "IN_PROGRESS" || state === "NOT_STARTED",
  );
  if (input.cushions !== "NOT_REQUIRED" || groupActive) {
    for (const [resource, state] of upholstery) {
      if (state === "NOT_REQUIRED" || state === "OTHER") continue;
      if (state === "BLANK" && !groupActive) continue;
      operations.push(plannedOp(resource, opStatus(state)));
    }
  }

  const productionOpen = operations.some((op) => op.status !== "COMPLETED");
  let quality: OpStatus = "NOT_STARTED";
  let pack: OpStatus = "NOT_STARTED";
  if (input.orderStatus === "READY FOR DELIVERY") {
    quality = "COMPLETED";
    pack = "COMPLETED";
  } else if (operations.length > 0 && !productionOpen) {
    quality = "IN_PROGRESS";
  }
  operations.push(plannedOp("Quality Control", quality));
  operations.push(plannedOp("Assembly & Packaging", pack));

  const moStatus =
    input.orderStatus === "READY FOR DELIVERY"
      ? "DONE"
      : operations.every((op) => op.status === "NOT_STARTED")
        ? "NOT_STARTED"
        : "IN_PROGRESS";
  return { operations, moStatus };
}

function fabricDisposition(status: string): { disposition: Disposition; reason: string } {
  const value = status.trim().toUpperCase();
  if (value === "OUT OF STOCK" || value === "IN STOCK" || value === "ORDERED") {
    return { disposition: "recipe-row", reason: value };
  }
  if (value === "RECEIVED" || value === "CLIENTE") {
    return { disposition: "skip", reason: value || "blank" };
  }
  if (value === "DISCONTINUED") {
    return { disposition: "exception", reason: "DISCONTINUED" };
  }
  return { disposition: "exception", reason: value || "blank status" };
}

function orderSort(left: string, right: string): number {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
  return left.localeCompare(right);
}

const VENDOR_HUB_ALIASES: Record<string, string> = {
  "640-0021": "FAB-SNO-CAP",
};

function hubForVendor(map: Map<string, HubEntry>, vendorSku: string): HubEntry | null {
  const direct = map.get(vendorSku);
  if (direct) return direct;
  const collapsed = vendorSku.replace(/-0+(\d{3})$/, "-$1");
  if (collapsed !== vendorSku) {
    const hit = map.get(collapsed);
    if (hit) return hit;
  }
  const alias = VENDOR_HUB_ALIASES[vendorSku];
  if (alias) return { hubSku: alias, name: "" };
  return null;
}

function loadHubMap(): Map<string, HubEntry> {
  const map = new Map<string, HubEntry>();
  let rows: Record<string, string>[] = [];
  try {
    rows = readCsv(HUB_MAP_PATH);
  } catch {
    return map;
  }
  for (const row of rows) {
    const hubSku = col(row, "Variant code / SKU").toUpperCase();
    const vendor = col(row, "Supplier item code").toUpperCase();
    const name = col(row, "Material name");
    if (!hubSku || !vendor) continue;
    map.set(vendor, { hubSku, name });
  }
  return map;
}

function readCsv(path: string): Record<string, string>[] {
  return readCsvRecords(path);
}

function blankDate(raw: string): string {
  const value = raw.trim();
  if (!value || value.toUpperCase() === "HOLD") return "";
  return value;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Factory-local noon, so the calendar date stays the sheet date in Arizona. */
function productionDeadlineIso(raw: string): string | null {
  const value = blankDate(raw);
  if (!value) return null;
  const named = value.match(/^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let year = 0;
  let month = 0;
  let day = 0;
  if (named) {
    month = MONTHS[named[1]!.slice(0, 3).toLowerCase()] ?? 0;
    day = Number(named[2]);
    year = Number(named[3]);
  } else if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    year = Number(numeric[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}T19:00:00.000Z`;
}

function noteLine(label: string, value: string): string {
  const text = value.trim();
  return `${label}: ${text || "—"}`;
}

function uniqueInOrder(values: string[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    names.push(text);
  }
  return names.join(", ");
}

function buildAdditionalInfo(input: {
  legacyOrder: string;
  type: string;
  deadline: string;
  delivery: string;
  address: string;
  pieces: string;
  clients: string;
  puDrop: string;
  deliveryConf: string;
  puDropConfirmed: string;
  foam: string;
  covers: string;
  umbrella: string;
  tenjam: string;
  firepit: string;
  projCushion: string;
  projMetal: string;
  projDekton: string;
  salesRep: string;
}): string {
  const header = [
    `Legacy order ${input.legacyOrder}`,
    input.type ? `Type: ${input.type}` : "",
    input.deadline ? `Production deadline: ${input.deadline}` : "",
    input.delivery ? `Delivery: ${input.delivery}` : "",
    input.pieces ? `Piece counts: ${input.pieces}` : "",
    input.clients ? `Fabric sheet client: ${input.clients}` : "",
    input.address ? `Address: ${input.address}` : "",
  ].filter(Boolean);
  const sections = [
    header.join("\n"),
    [
      "Logistics",
      noteLine("PU / DROP", input.puDrop),
      noteLine("Delivery Conf.", input.deliveryConf),
      noteLine("PU / DROP Confirmed", input.puDropConfirmed),
    ].join("\n"),
    [
      "Purchasing",
      noteLine("FOAM", input.foam),
      noteLine("Covers", input.covers),
      noteLine("Umbrella", input.umbrella),
      noteLine("Tenjam/Others", input.tenjam),
      noteLine("Firepit System", input.firepit),
    ].join("\n"),
    [
      "Labor projections",
      noteLine("Proj. Hrs Cushion", input.projCushion),
      noteLine("Proj. Hrs Metal", input.projMetal),
      noteLine("Proj. Hrs Dekton", input.projDekton),
    ].join("\n"),
    ["Sales", noteLine("SALE", input.salesRep)].join("\n"),
  ];
  return sections.join("\n\n");
}

function indexParent(
  index: Map<string, VariantHit>,
  parent: Record<string, unknown>,
  kind: "material" | "product",
): void {
  const name = String(parent.name ?? "").trim();
  const parentId = Number(parent.id);
  const variants = Array.isArray(parent.variants) ? parent.variants : [];
  for (const variant of variants) {
    const record = asRecord(variant);
    if (!record) continue;
    const sku = String(record.sku ?? "").trim().toUpperCase();
    const variantId = Number(record.id);
    if (!sku || !Number.isFinite(variantId) || variantId <= 0 || index.has(sku)) continue;
    index.set(sku, {
      variantId,
      sku,
      name: name || sku,
      materialId: kind === "material" && Number.isFinite(parentId) ? parentId : null,
      productId: kind === "product" && Number.isFinite(parentId) ? parentId : null,
    });
  }
}

async function listKatana(path: string, label: string, maxPages = 40): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let previousFirstId: number | null = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await katanaFetch(`${path}?limit=250&page=${page}`);
    const rows = unwrapList<Record<string, unknown>>(data);
    if (rows.length === 0) break;
    const firstId = Number(rows[0]?.id);
    if (page > 1 && firstId > 0 && firstId === previousFirstId) break;
    previousFirstId = Number.isFinite(firstId) ? firstId : previousFirstId;
    all.push(...rows);
    if (rows.length < 250) break;
  }
  console.log(`  ${label}: ${all.length}`);
  return all;
}

async function loadVariantIndex(needed: string[]): Promise<Map<string, VariantHit>> {
  const index = new Map<string, VariantHit>();
  const materials = await listKatana("/materials", "materials");
  const products = await listKatana("/products", "products");
  for (const row of materials) indexParent(index, row, "material");
  for (const row of products) indexParent(index, row, "product");
  console.log(`  catalog index ${index.size} variants from ${materials.length} materials and ${products.length} products`);

  for (const sku of needed) {
    if (index.has(sku)) continue;
    const found = await findVariantBySku(sku);
    if (!found) continue;
    index.set(sku.toUpperCase(), {
      variantId: found.id,
      sku: found.sku.toUpperCase(),
      name: sku,
      materialId: found.material_id,
      productId: found.product_id,
    });
  }
  return index;
}

async function loadStock(variantIds: number[]): Promise<Map<number, StockSnap>> {
  const totals = new Map<number, StockSnap>();
  for (let index = 0; index < variantIds.length; index += 40) {
    const chunk = variantIds.slice(index, index + 40);
    const params = new URLSearchParams();
    params.set("limit", "250");
    for (const id of chunk) params.append("variant_id", String(id));
    const { data } = await katanaFetch(`/inventory?${params.toString()}`);
    const rows = unwrapList<Record<string, unknown>>(data);
    for (const row of rows) {
      if (Number(row.location_id) !== CC_MANUFACTURING_LOCATION_ID) continue;
      const variantId = Number(row.variant_id);
      if (!Number.isFinite(variantId)) continue;
      const current = totals.get(variantId) ?? { inStock: 0, committed: 0, calculated: 0 };
      current.inStock = roundYards(current.inStock + Number(row.quantity_in_stock ?? 0));
      current.committed = roundYards(current.committed + Number(row.quantity_committed ?? 0));
      current.calculated = roundYards(current.inStock - current.committed);
      totals.set(variantId, current);
    }
  }
  return totals;
}

async function loadHoldQuantities(): Promise<Map<number, { quantity: number; rowId: number; notes: string }>> {
  const { data } = await katanaFetch(`/sales_orders/${FABRIC_HOLD_ORDER_ID}`);
  const order = asRecord(data) ?? {};
  const body = order.sales_order_rows ? order : (asRecord(order.data) ?? order);
  if (String(body.order_no ?? "") !== FABRIC_HOLD_ORDER_NO) {
    throw new Error(`Sales order ${FABRIC_HOLD_ORDER_ID} is not ${FABRIC_HOLD_ORDER_NO}.`);
  }
  const map = new Map<number, { quantity: number; rowId: number; notes: string }>();
  const rows = Array.isArray(body.sales_order_rows) ? body.sales_order_rows : [];
  for (const row of rows) {
    const record = asRecord(row);
    const variantId = Number(record?.variant_id);
    const quantity = Number(record?.quantity);
    const rowId = Number(record?.id);
    if (!Number.isFinite(variantId) || !Number.isFinite(quantity) || !Number.isFinite(rowId)) continue;
    const current = map.get(variantId);
    if (!current || quantity > current.quantity) {
      map.set(variantId, {
        quantity,
        rowId,
        notes: typeof record?.notes === "string" ? record.notes : "",
      });
    }
  }
  return map;
}

/**
 * Katana's public API base is already `https://api.katanamrp.com/v1`.
 * `GET /resources` is that full path and returns 404 — there is no resources
 * collection. Resource ids are carried on product operation rows.
 * Create only accepts status NOT_STARTED; the target status is a follow-up PATCH.
 */
async function loadResources(): Promise<Map<string, number>> {
  const live: Array<{ name: string; id: number }> = [];
  const seen = new Set<string>();
  let previousFirstId: number | null = null;
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await katanaFetch(`/product_operation_rows?limit=250&page=${page}`);
    const rows = unwrapList<Record<string, unknown>>(data);
    if (rows.length === 0) break;
    const firstId = Number(rows[0]?.product_operation_row_id ?? rows[0]?.id);
    if (page > 1 && firstId > 0 && firstId === previousFirstId) break;
    previousFirstId = Number.isFinite(firstId) ? firstId : previousFirstId;
    for (const row of rows) {
      const name = String(row.resource_name ?? "").trim();
      const id = Number(row.resource_id);
      const key = name.toLowerCase();
      if (!name || !Number.isFinite(id) || id <= 0 || seen.has(key)) continue;
      seen.add(key);
      live.push({ name, id });
    }
    if (rows.length < 250) break;
  }

  const exact = new Map<string, number>();
  const aliased = new Map<string, number>();
  for (const row of live) {
    exact.set(row.name.toLowerCase(), row.id);
    const locked = LEGACY_RESOURCE_ALIASES[row.name];
    if (locked && !aliased.has(locked.toLowerCase())) aliased.set(locked.toLowerCase(), row.id);
  }
  const resolved = new Map<string, number>(exact);
  for (const [name, id] of aliased) {
    if (!resolved.has(name)) resolved.set(name, id);
  }
  console.log(
    `  resource ids from product operation rows: ${live.length} live names, ${resolved.size} addressable`,
  );
  if (live.length > 0) {
    console.log(`  live resources: ${live.map((row) => `${row.name}#${row.id}`).join(", ")}`);
  }
  return resolved;
}

async function hubVariantFromDb(skus: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (skus.length === 0) return found;
  try {
    const { getDb, closeDb } = await import("../../src/server/db/client");
    const { sku_aliases, sku_mappings } = await import("../../src/server/db/schema");
    const db = getDb();
    for (const sku of skus) {
      const [alias] = await db
        .select({ canonical: sku_aliases.canonical_sku })
        .from(sku_aliases)
        .where(eq(sku_aliases.alias_sku, sku))
        .limit(1);
      const canonical = (alias?.canonical ?? sku).trim().toUpperCase();
      const [mapping] = await db
        .select({ variantId: sku_mappings.katana_variant_id })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, canonical))
        .limit(1);
      if (mapping?.variantId && mapping.variantId > 0) found.set(sku, mapping.variantId);
    }
    await closeDb();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`  Hub sku lookup skipped: ${message}`);
  }
  return found;
}

function readLedger(): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Partial<Ledger>;
    return {
      updatedAt: parsed.updatedAt ?? "",
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    };
  } catch {
    return { updatedAt: "", orders: [] };
  }
}

function writeLedger(ledger: Ledger): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
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

async function syncSalesOrderNotes(
  salesOrderId: number,
  additionalInfo: string,
  current?: string,
): Promise<void> {
  let existing = current;
  if (existing == null) {
    const fetched = await katanaFetch<Record<string, unknown>>(`/sales_orders/${salesOrderId}`);
    const record = asRecord(fetched.data) ?? {};
    existing = typeof record.additional_info === "string" ? record.additional_info : "";
  }
  if (existing.replace(/\r\n/g, "\n") === additionalInfo) return;
  await katanaFetch(`/sales_orders/${salesOrderId}`, {
    method: "PATCH",
    body: { additional_info: additionalInfo },
  });
}

async function findExistingSalesOrder(orderNo: string): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/sales_orders?order_no=${encodeURIComponent(orderNo)}&limit=50`,
  );
  const rows = unwrapList<Record<string, unknown>>(data);
  return rows.find((row) => String(row.order_no ?? "") === orderNo) ?? null;
}

async function ensureCustomer(name: string, cache: Map<string, number>): Promise<number> {
  const hit = cache.get(name);
  if (hit) return hit;
  const { data } = await katanaFetch<Record<string, unknown>>("/customers", {
    method: "POST",
    body: { name, currency: "USD" },
    idempotencyKey: `wip-customer:${name.toLowerCase()}`,
  });
  const id = Number(data.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Katana created customer "${name}" without an id.`);
  }
  cache.set(name, id);
  return id;
}

async function loadCustomerCache(): Promise<Map<string, number>> {
  const cache = new Map<string, number>();
  const rows = await listKatana("/customers", "customers");
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    const id = Number(row.id);
    if (name && Number.isFinite(id) && id > 0 && !cache.has(name)) cache.set(name, id);
  }
  return cache;
}

async function ensureShell(index: Map<string, VariantHit>): Promise<VariantHit> {
  const existing = index.get(SHELL_SKU) ?? null;
  if (existing?.productId) return existing;
  const looked = await findVariantBySku(SHELL_SKU);
  if (looked?.product_id) {
    const hit: VariantHit = {
      variantId: looked.id,
      sku: SHELL_SKU,
      name: SHELL_NAME,
      materialId: null,
      productId: looked.product_id,
    };
    index.set(SHELL_SKU, hit);
    return hit;
  }
  const { data } = await katanaFetch<Record<string, unknown>>("/products", {
    method: "POST",
    idempotencyKey: "wip-shell:FIN-WIP-SHEET",
    body: {
      name: SHELL_NAME,
      uom: "pcs",
      category_name: "Finished goods",
      additional_info: "Migration shell for in-flight sheet orders. Recipes live on the manufacturing order.",
      is_sellable: true,
      is_producible: true,
      is_purchasable: false,
      variants: [{ sku: SHELL_SKU }],
    },
  });
  const productId = Number(data.id);
  const variant = asRecord(Array.isArray(data.variants) ? data.variants[0] : null);
  const variantId = Number(variant?.id);
  if (!Number.isFinite(productId) || !Number.isFinite(variantId)) {
    throw new Error("Katana created FIN-WIP-SHEET without a variant id.");
  }
  const hit: VariantHit = {
    variantId,
    sku: SHELL_SKU,
    name: SHELL_NAME,
    materialId: null,
    productId,
  };
  index.set(SHELL_SKU, hit);
  return hit;
}

async function ensureMintedMaterial(spec: (typeof MINTS)[number], index: Map<string, VariantHit>): Promise<VariantHit> {
  const key = spec.vendorSku.toUpperCase();
  const existing = index.get(key);
  if (existing) return existing;
  const looked = await findVariantBySku(key);
  if (looked) {
    const hit: VariantHit = {
      variantId: looked.id,
      sku: looked.sku.toUpperCase(),
      name: spec.name,
      materialId: looked.material_id,
      productId: looked.product_id,
    };
    index.set(key, hit);
    return hit;
  }
  const { data } = await katanaFetch<Record<string, unknown>>("/materials", {
    method: "POST",
    idempotencyKey: `wip-material:${key}`,
    body: {
      name: spec.name,
      uom: "yd",
      category_name: "Fabric",
      is_sellable: false,
      variants: [{ sku: key }],
    },
  });
  const materialId = Number(data.id);
  const variant = asRecord(Array.isArray(data.variants) ? data.variants[0] : null);
  const variantId = Number(variant?.id);
  if (!Number.isFinite(materialId) || !Number.isFinite(variantId)) {
    throw new Error(`Katana created material ${key} without a variant id.`);
  }
  const hit: VariantHit = {
    variantId,
    sku: key,
    name: spec.name,
    materialId,
    productId: null,
  };
  index.set(key, hit);
  return hit;
}

async function listMoRecipeRows(manufacturingOrderId: number): Promise<Array<{ id: number; notes: string; variantId: number }>> {
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

async function reopenDoneManufacturingOrder(manufacturingOrderId: number): Promise<void> {
  const fetched = await katanaFetch<Record<string, unknown>>(`/manufacturing_orders/${manufacturingOrderId}`);
  const status = String((asRecord(fetched.data) ?? {}).status ?? "");
  if (status !== "DONE") return;
  console.log(`  reopen manufacturing order ${manufacturingOrderId} from DONE to NOT_STARTED`);
  await katanaFetch(`/manufacturing_orders/${manufacturingOrderId}`, {
    method: "PATCH",
    body: { status: "NOT_STARTED" },
  });
}

async function listMoOperationRows(manufacturingOrderId: number): Promise<Array<{ id: number; name: string; status: string }>> {
  const rows: Array<{ id: number; name: string; status: string }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await katanaFetch(
      `/manufacturing_order_operation_rows?manufacturing_order_id=${manufacturingOrderId}&limit=50&page=${page}`,
    );
    const pageRows = unwrapList<Record<string, unknown>>(data);
    for (const row of pageRows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      rows.push({
        id,
        name: String(row.operation_name ?? ""),
        status: String(row.status ?? ""),
      });
    }
    if (pageRows.length < 50) break;
  }
  return rows;
}

async function executeLive(input: {
  orders: PlannedOrder[];
  index: Map<string, VariantHit>;
  hold: Map<number, { quantity: number; rowId: number; notes: string }>;
  blocked: GateBlock[];
}): Promise<void> {
  if (input.blocked.length > 0) {
    const hard = input.blocked.filter(
      (block) => block.reason !== "live stock covers this line, so Katana would not flag a shortage",
    );
    for (const block of input.blocked) {
      if (hard.includes(block)) continue;
      console.log(`  in stock ${block.legacyOrder} ${block.vendorSku}: sheet says out of stock, live quantity covers the recipe`);
    }
    if (hard.length > 0) {
      throw new Error(
        `Refusing --confirm. Shortage gate has ${hard.length} blocker(s). Re-run --dry-run and review shortageGate.blocked.`,
      );
    }
  }

  const ledger = readLedger();
  const done = new Set(ledger.orders.map((order) => order.legacyOrder));
  const customers = await loadCustomerCache();
  await ensureShell(input.index);
  for (const spec of MINTS) {
    const needed = input.orders.some((order) =>
      order.fabrics.some((fabric) => fabric.mint && fabric.vendorSku === spec.vendorSku && fabric.disposition === "recipe-row"),
    );
    if (needed) await ensureMintedMaterial(spec, input.index);
  }

  for (const order of input.orders) {
    if (done.has(order.legacyOrder)) {
      const prior = ledger.orders.find((row) => row.legacyOrder === order.legacyOrder);
      if (!prior?.salesOrderId) {
        console.log(`  skip ${order.katanaOrderNo} (ledger)`);
        continue;
      }
      await syncSalesOrderNotes(prior.salesOrderId, order.additionalInfo);
      console.log(`  notes ${order.katanaOrderNo} sales order ${prior.salesOrderId}`);
      continue;
    }
    const shell = input.index.get(SHELL_SKU);
    if (!shell) throw new Error("FIN-WIP-SHEET is missing after ensure.");

    const customerId = await ensureCustomer(order.customer, customers);
    let salesOrderId = order.existingSalesOrderId;
    if (!salesOrderId) {
      const again = await findExistingSalesOrder(order.katanaOrderNo);
      salesOrderId = again ? Number(again.id) || null : null;
    }
    let rowIds: number[] = [];
    if (salesOrderId) {
      console.log(`  attach ${order.katanaOrderNo} to existing sales order ${salesOrderId}`);
      const fetched = await katanaFetch<Record<string, unknown>>(`/sales_orders/${salesOrderId}`);
      const record = asRecord(fetched.data) ?? {};
      rowIds = salesOrderRowIds(record);
      await syncSalesOrderNotes(
        salesOrderId,
        order.additionalInfo,
        typeof record.additional_info === "string" ? record.additional_info : "",
      );
    } else {
      const { data } = await katanaFetch<Record<string, unknown>>("/sales_orders", {
        method: "POST",
        idempotencyKey: `wip-so-${order.legacyOrder}`,
        body: {
          order_no: order.katanaOrderNo,
          customer_id: customerId,
          location_id: CC_MANUFACTURING_LOCATION_ID,
          currency: "USD",
          additional_info: order.additionalInfo,
          customer_ref: order.legacyOrder,
          sales_order_rows: [
            { variant_id: shell.variantId, quantity: 1, price_per_unit: 0 },
          ],
        },
      });
      salesOrderId = Number(data.id);
      rowIds = salesOrderRowIds(data);
      if (rowIds.length === 0 && Number.isFinite(salesOrderId)) {
        const fetched = await katanaFetch<Record<string, unknown>>(`/sales_orders/${salesOrderId}`);
        rowIds = salesOrderRowIds(asRecord(fetched.data) ?? {});
      }
    }
    if (!salesOrderId || rowIds.length !== 1) {
      throw new Error(`${order.katanaOrderNo} has ${rowIds.length} sales order rows; expected 1.`);
    }
    const salesOrderRowId = rowIds[0]!;

    const { data: moList } = await katanaFetch(
      `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=50`,
    );
    let manufacturingOrderId = 0;
    for (const row of unwrapList<Record<string, unknown>>(moList)) {
      if (Number(row.sales_order_row_id) === salesOrderRowId) {
        manufacturingOrderId = Number(row.id);
        break;
      }
    }
    if (!manufacturingOrderId) {
      try {
        const created = await createMakeToOrderManufacturingOrders([salesOrderRowId], {
          createSubassemblies: false,
        });
        manufacturingOrderId = created[0]?.manufacturingOrderId ?? 0;
      } catch (error: unknown) {
        if (!(error instanceof KatanaApiError) || error.status !== 422) throw error;
        const generic = await findVariantBySku("RM-FAB-GENERIC");
        if (!generic) throw error;
        await katanaFetch("/recipes", {
          method: "POST",
          body: {
            keep_current_rows: true,
            rows: [
              {
                product_variant_id: shell.variantId,
                ingredient_variant_id: generic.id,
                quantity: 1,
                notes: "WIP shell placeholder. Removed from each manufacturing order after real fabric rows post.",
              },
            ],
          },
        });
        const created = await createMakeToOrderManufacturingOrders([salesOrderRowId], {
          createSubassemblies: false,
        });
        manufacturingOrderId = created[0]?.manufacturingOrderId ?? 0;
      }
    }
    if (!manufacturingOrderId) throw new Error(`${order.katanaOrderNo} manufacturing order was not created.`);
    console.log(`  attach ${order.katanaOrderNo} manufacturing order ${manufacturingOrderId}`);
    await reopenDoneManufacturingOrder(manufacturingOrderId);

    const recipeIds: number[] = [];
    const existingRecipes = await listMoRecipeRows(manufacturingOrderId);
    for (const row of existingRecipes) {
      if (row.notes.startsWith("wip-fabric:")) recipeIds.push(row.id);
    }
    const genericVariant = await findVariantBySku("RM-FAB-GENERIC");
    const genericRows = existingRecipes.filter(
      (row) =>
        !row.notes.startsWith("wip-fabric:") &&
        genericVariant != null &&
        row.variantId === genericVariant.id,
    );
    for (const fabric of order.fabrics) {
      if (fabric.disposition !== "recipe-row" || fabric.yards == null || fabric.yards <= 0) continue;
      const variant = fabric.mint
        ? input.index.get(fabric.vendorSku.toUpperCase())
        : fabric.variantId
          ? { variantId: fabric.variantId }
          : null;
      const variantId = variant && "variantId" in variant ? variant.variantId : null;
      if (!variantId) throw new Error(`${order.katanaOrderNo} ${fabric.vendorSku} has no variant at write time.`);
      const token = `wip-fabric:${order.legacyOrder}:${fabric.vendorSku}`;
      const already = existingRecipes.find((row) => row.notes.includes(token));
      if (already) {
        if (!recipeIds.includes(already.id)) recipeIds.push(already.id);
        continue;
      }
      const { data } = await katanaFetch<Record<string, unknown>>("/manufacturing_order_recipe_rows", {
        method: "POST",
        idempotencyKey: token,
        body: {
          manufacturing_order_id: manufacturingOrderId,
          variant_id: variantId,
          planned_quantity_per_unit: fabric.yards,
          notes: `${token} ${fabric.note}`.trim().slice(0, 500),
        },
      });
      const id = Number(data.id);
      if (Number.isFinite(id)) recipeIds.push(id);
    }
    for (const generic of genericRows) {
      await katanaFetch(`/manufacturing_order_recipe_rows/${generic.id}`, { method: "DELETE" });
    }

    const operationIds: number[] = [];
    const statusPatches: Array<{ id: number; status: string }> = [];
    const existingOps = await listMoOperationRows(manufacturingOrderId);
    console.log(
      `  existing operations: ${existingOps.map((row) => `${row.name}=${row.status}`).join(", ") || "(none)"}`,
    );
    for (const op of order.operations) {
      const match = existingOps.find((row) => row.name === op.operationName);
      if (match) {
        operationIds.push(match.id);
        if (match.status !== op.status) statusPatches.push({ id: match.id, status: op.status });
        continue;
      }
      const { data } = await katanaFetch<Record<string, unknown>>("/manufacturing_order_operation_rows", {
        method: "POST",
        body: {
          manufacturing_order_id: manufacturingOrderId,
          operation_name: op.operationName,
          status: "NOT_STARTED",
          type: "process",
          ...(op.plannedTimeSeconds > 0
            ? { planned_time_parameter: op.plannedTimeSeconds }
            : {}),
          ...(op.resourceId
            ? { resource_id: op.resourceId }
            : { resource_name: op.resource }),
        },
      });
      const created = asRecord(data) ?? {};
      const id = Number(created.id ?? asRecord(created.data)?.id);
      if (!Number.isFinite(id)) {
        throw new Error(`${order.katanaOrderNo} operation ${op.operationName} was created without an id.`);
      }
      operationIds.push(id);
      if (op.status !== "NOT_STARTED") statusPatches.push({ id, status: op.status });
    }
    for (const patch of statusPatches) {
      await katanaFetch(`/manufacturing_order_operation_rows/${patch.id}`, {
        method: "PATCH",
        body: { status: patch.status },
      });
    }

    const moFetched = await katanaFetch<Record<string, unknown>>(`/manufacturing_orders/${manufacturingOrderId}`);
    const moRecord = asRecord(moFetched.data) ?? {};
    let currentStatus = String(moRecord.status ?? "");
    if (currentStatus === "DONE" && order.moStatus !== "DONE") {
      await reopenDoneManufacturingOrder(manufacturingOrderId);
      currentStatus = "NOT_STARTED";
    }
    const moPatch: Record<string, unknown> = {};
    if (currentStatus !== order.moStatus) moPatch.status = order.moStatus;
    if (Object.keys(moPatch).length > 0) {
      await katanaFetch(`/manufacturing_orders/${manufacturingOrderId}`, {
        method: "PATCH",
        body: moPatch,
      });
    }

    if (relieveHold) {
      for (const fabric of order.fabrics) {
        if (!fabric.preFreeze || fabric.disposition !== "recipe-row" || !fabric.variantId || fabric.yards == null) {
          continue;
        }
        const line = input.hold.get(fabric.variantId);
        if (!line || line.quantity <= 0) continue;
        const token = `wip-relief:${order.katanaOrderNo}:${fabric.vendorSku}`;
        if (line.notes.includes(token)) continue;
        const yards = Math.min(fabric.yards, line.quantity);
        const decision = nextHoldQuantity(line.quantity, yards);
        if (decision.action === "refuse") throw new Error(decision.error);
        const notes = [line.notes.trim(), token].filter(Boolean).join(" ");
        if (decision.action === "delete") {
          await katanaFetch(`/sales_order_rows/${line.rowId}`, { method: "DELETE" });
          input.hold.delete(fabric.variantId);
        } else {
          await katanaFetch(`/sales_order_rows/${line.rowId}`, {
            method: "PATCH",
            idempotencyKey: `${token}:${decision.quantity}`,
            body: { quantity: decision.quantity, notes },
          });
          line.quantity = decision.quantity;
          line.notes = notes;
        }
      }
    }

    ledger.orders.push({
      legacyOrder: order.legacyOrder,
      katanaOrderNo: order.katanaOrderNo,
      salesOrderId,
      salesOrderRowId,
      manufacturingOrderId,
      recipeRowIds: recipeIds,
      operationRowIds: operationIds,
    });
    writeLedger(ledger);
    console.log(`  wrote ${order.katanaOrderNo} so=${salesOrderId} mo=${manufacturingOrderId}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--relieve-hold") && !confirm) {
    console.log("--relieve-hold is ignored unless --confirm is set without --dry-run.");
  }
  console.log(confirm ? "LIVE confirm. Katana writes are enabled." : "Dry-run. No Katana writes.");
  if (orderFilter) console.log(`  order filter ${orderFilter}`);

  setKatanaRequestPacer(createIntervalPacer(1600));

  const standardRows = readCsv(STANDARD_PATH);
  const fabricRows = readCsv(FABRIC_PATH);
  const hubMap = loadHubMap();

  let excludedCompleted = 0;
  const statusExceptions: Array<{ legacyOrder: string; status: string }> = [];
  const seen = new Set<string>();
  const openRows: Record<string, string>[] = [];
  for (const row of standardRows) {
    const status = col(row, "Status").toUpperCase();
    const legacyOrder = col(row, "Order Number");
    if (status === "ORDER COMPLETED") {
      excludedCompleted += 1;
      continue;
    }
    if (status !== "NEW" && status !== "READY FOR DELIVERY") {
      statusExceptions.push({ legacyOrder, status: col(row, "Status") });
      continue;
    }
    if (seen.has(legacyOrder)) {
      statusExceptions.push({ legacyOrder, status: `duplicate ${status}` });
      continue;
    }
    seen.add(legacyOrder);
    openRows.push(row);
  }

  const selected = orderFilter
    ? openRows.filter((row) => col(row, "Order Number") === orderFilter)
    : openRows;
  if (orderFilter && selected.length === 0) {
    throw new Error(`Order ${orderFilter} is not in the NEW / READY FOR DELIVERY set.`);
  }

  const fabricsByOrder = new Map<string, Record<string, string>[]>();
  for (const row of fabricRows) {
    const legacyOrder = col(row, "ORDER");
    if (!legacyOrder || !seen.has(legacyOrder)) continue;
    const list = fabricsByOrder.get(legacyOrder) ?? [];
    list.push(row);
    fabricsByOrder.set(legacyOrder, list);
  }

  const orders: PlannedOrder[] = [];
  const localExceptions: Array<{ legacyOrder: string; vendorSku: string; reason: string }> = [];

  for (const row of selected) {
    const legacyOrder = col(row, "Order Number");
    const orderStatus = col(row, "Status").toUpperCase() === "READY FOR DELIVERY"
      ? "READY FOR DELIVERY"
      : "NEW";
    const metal = cellState(col(row, "METAL"));
    const powder = cellState(col(row, "POWDER COAT"));
    const dekton = cellState(col(row, "DEKTON"));
    const cushions = cellState(col(row, "CUSHIONS"));
    const corte = cellState(col(row, "CORTE"));
    const sew = cellState(col(row, "SEW"));
    const filling = cellState(col(row, "FILLING"));
    for (const [label, state] of [
      ["METAL", metal],
      ["POWDER COAT", powder],
      ["DEKTON", dekton],
      ["CUSHIONS", cushions],
      ["CORTE", corte],
      ["SEW", sew],
      ["FILLING", filling],
    ] as const) {
      if (state === "OTHER") {
        localExceptions.push({
          legacyOrder,
          vendorSku: "",
          reason: `${label} has an unrecognized status "${col(row, label)}"`,
        });
      }
    }
    const built = buildOperations({
      orderStatus,
      metal,
      powder,
      dekton,
      corte,
      sew,
      filling,
      cushions,
    });
    const fabricSource = fabricsByOrder.get(legacyOrder) ?? [];
    const fabrics: PlannedFabric[] = fabricSource.map((fabric) => {
      const vendorSku = col(fabric, "SKU").toUpperCase();
      const sheetStatus = col(fabric, "STATUS");
      const decision = fabricDisposition(sheetStatus);
      const yards = parseQty(col(fabric, "QTY NEED"));
      const intro = col(fabric, "DATE INTRO");
      const introUtc = parseSheetDate(intro);
      const hub = vendorSku ? hubForVendor(hubMap, vendorSku) : null;
      return {
        vendorSku,
        hubSku: hub?.hubSku ?? null,
        name: col(fabric, "FABRIC") || hub?.name || "",
        yards,
        sheetStatus,
        dateIntro: intro,
        disposition: decision.disposition,
        dispositionReason: decision.reason,
        predictedAvailability: null,
        variantId: null,
        resolvedSku: null,
        mint: false,
        katana: null,
        sheetStock: parseQty(col(fabric, "STOCK")),
        sheetDifference: parseQty(col(fabric, "DIFERENCE")),
        client: col(fabric, "CLIENT"),
        note: col(fabric, "NOTE"),
        preFreeze: introUtc != null && introUtc <= HOLD_CUTOFF_UTC,
      };
    });
    const clients = [...new Set(fabrics.map((fabric) => fabric.client).filter(Boolean))].join("; ");
    const customer = col(row, "Customer Info");
    if (!customer) {
      localExceptions.push({ legacyOrder, vendorSku: "", reason: "Customer Info is blank" });
    }
    orders.push({
      legacyOrder,
      katanaOrderNo: `WIP-${legacyOrder}`,
      customer,
      orderStatus,
      type: col(row, "Type"),
      additionalInfo: buildAdditionalInfo({
        legacyOrder,
        type: col(row, "Type"),
        deadline: blankDate(col(row, "Production Deadline")),
        delivery: blankDate(col(row, "Delivery Date")),
        address: col(row, "Delivery Address"),
        pieces: `cushions ${col(row, "QTY CUSH") || "0"}, metal ${col(row, "QTY METAL") || "0"}, dekton ${col(row, "QTY DEKT") || "0"}`,
        clients,
        puDrop: col(row, "PU / DROP"),
        deliveryConf: col(row, "Delivery Conf."),
        puDropConfirmed: col(row, "PU / DROP Confirmed"),
        foam: col(row, "FOAM"),
        covers: col(row, "Covers"),
        umbrella: col(row, "Umbrella"),
        tenjam: col(row, "Tenjam/Others"),
        firepit: col(row, "Firepit System"),
        projCushion: col(row, "Proj. Hrs Cushion"),
        projMetal: col(row, "Proj. Hrs Metal"),
        projDekton: col(row, "Proj. Hrs Dekton"),
        salesRep: uniqueInOrder(fabricSource.map((fabric) => col(fabric, "SALE"))),
      }),
      existingSalesOrderId: null,
      productionDeadline: productionDeadlineIso(col(row, "Production Deadline")),
      moStatus: built.moStatus,
      operations: built.operations,
      fabrics,
    });
  }
  orders.sort((left, right) => orderSort(left.legacyOrder, right.legacyOrder));

  const needed = new Set<string>([SHELL_SKU, ...MINTS.map((spec) => spec.proposedHubSku)]);
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      if (fabric.disposition !== "recipe-row") continue;
      if (fabric.vendorSku) needed.add(fabric.vendorSku);
      if (fabric.hubSku) needed.add(fabric.hubSku);
    }
  }

  console.log(`Resolving ${needed.size} SKUs against Katana…`);
  const index = await loadVariantIndex([...needed]);
  const unresolvedForDb: string[] = [];
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      if (fabric.disposition !== "recipe-row" || !fabric.vendorSku) continue;
      const byVendor = index.get(fabric.vendorSku);
      const byHub = fabric.hubSku ? index.get(fabric.hubSku) : undefined;
      const hit = byVendor ?? byHub;
      if (hit) {
        fabric.variantId = hit.variantId;
        fabric.resolvedSku = hit.sku;
        fabric.mint = false;
        if (!fabric.name) fabric.name = hit.name;
      } else if (MINTS.some((spec) => spec.vendorSku === fabric.vendorSku)) {
        fabric.mint = true;
      } else {
        unresolvedForDb.push(fabric.vendorSku);
        if (fabric.hubSku) unresolvedForDb.push(fabric.hubSku);
      }
    }
  }
  const dbHits = await hubVariantFromDb([...new Set(unresolvedForDb)]);
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      if (fabric.variantId || fabric.mint || fabric.disposition !== "recipe-row") continue;
      const variantId = dbHits.get(fabric.vendorSku) ?? (fabric.hubSku ? dbHits.get(fabric.hubSku) : undefined);
      if (!variantId) continue;
      fabric.variantId = variantId;
      fabric.resolvedSku = fabric.hubSku ?? fabric.vendorSku;
    }
  }

  const variantIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.fabrics.map((fabric) => fabric.variantId).filter((id): id is number => id != null),
      ),
    ),
  ];
  console.log(`Reading inventory for ${variantIds.length} variants at location ${CC_MANUFACTURING_LOCATION_ID}…`);
  const stock = await loadStock(variantIds);
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      if (fabric.variantId == null) continue;
      fabric.katana = stock.get(fabric.variantId) ?? { inStock: 0, committed: 0, calculated: 0 };
    }
  }

  console.log(`Reading hold ${FABRIC_HOLD_ORDER_NO}…`);
  const hold = await loadHoldQuantities();
  const resources = await loadResources();
  for (const order of orders) {
    for (const op of order.operations) {
      op.resourceId = resources.get(op.resource.toLowerCase()) ?? null;
    }
  }

  console.log(`Checking ${orders.length} existing sales orders…`);
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index]!;
    const existing = await findExistingSalesOrder(order.katanaOrderNo);
    order.existingSalesOrderId = existing ? Number(existing.id) || null : null;
    if ((index + 1) % 10 === 0 || index === orders.length - 1) {
      console.log(`  probed ${index + 1}/${orders.length}`);
    }
  }

  const allocGroups = new Map<string, PlannedFabric[]>();
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      if (fabric.disposition !== "recipe-row" || fabric.yards == null || fabric.yards <= 0) continue;
      const key = fabric.variantId != null ? `v:${fabric.variantId}` : `mint:${fabric.vendorSku}`;
      const list = allocGroups.get(key) ?? [];
      list.push(fabric);
      allocGroups.set(key, list);
    }
  }
  for (const [key, lines] of allocGroups) {
    lines.sort((left, right) => left.vendorSku.localeCompare(right.vendorSku));
    const sample = lines[0]!;
    let remaining = sample.variantId != null ? (sample.katana?.calculated ?? 0) : 0;
    const ordered = orders
      .flatMap((order) => order.fabrics.filter((fabric) => lines.includes(fabric)).map((fabric) => ({ order, fabric })))
      .sort((left, right) => orderSort(left.order.legacyOrder, right.order.legacyOrder) || left.fabric.vendorSku.localeCompare(right.fabric.vendorSku));
    for (const { fabric } of ordered) {
      const yards = fabric.yards ?? 0;
      if (remaining + 0.0001 >= yards) {
        fabric.predictedAvailability = "IN_STOCK";
        remaining = roundYards(remaining - yards);
      } else {
        fabric.predictedAvailability = "NOT_AVAILABLE";
        remaining = roundYards(remaining - yards);
      }
    }
    void key;
  }

  const blocked: GateBlock[] = [];
  const holdOverlap: HoldOverlap[] = [];
  for (const order of orders) {
    for (const fabric of order.fabrics) {
      const holdLine = fabric.variantId != null ? hold.get(fabric.variantId) : undefined;
      if (fabric.preFreeze && holdLine && holdLine.quantity > 0) {
        holdOverlap.push({
          legacyOrder: order.legacyOrder,
          vendorSku: fabric.vendorSku,
          reason: "pre-freeze line still on MIG-HOLD-FABRIC-20260811",
          yards: fabric.yards,
          holdQuantity: holdLine.quantity,
          dateIntro: fabric.dateIntro,
        });
      }
      if (
        fabric.disposition === "recipe-row" &&
        (fabric.sheetStatus.toUpperCase() === "IN STOCK" || fabric.sheetStatus.toUpperCase() === "ORDERED") &&
        fabric.predictedAvailability === "NOT_AVAILABLE"
      ) {
        holdOverlap.push({
          legacyOrder: order.legacyOrder,
          vendorSku: fabric.vendorSku,
          reason: "in-stock or ordered sheet line is predicted NOT_AVAILABLE after hold and new demand",
          yards: fabric.yards,
          holdQuantity: holdLine?.quantity ?? null,
          dateIntro: fabric.dateIntro,
        });
      }
      if (fabric.disposition === "recipe-row" && fabric.variantId == null && !fabric.mint) {
        blocked.push({
          legacyOrder: order.legacyOrder,
          vendorSku: fabric.vendorSku,
          reason: "variant not in Katana and not in the mint list",
        });
        continue;
      }
      if (fabric.sheetStatus.toUpperCase() !== "OUT OF STOCK") continue;
      if (fabric.disposition !== "recipe-row") {
        blocked.push({ legacyOrder: order.legacyOrder, vendorSku: fabric.vendorSku, reason: fabric.dispositionReason });
        continue;
      }
      if (fabric.yards == null || fabric.yards <= 0) {
        blocked.push({ legacyOrder: order.legacyOrder, vendorSku: fabric.vendorSku, reason: "QTY NEED is missing" });
        continue;
      }
      if (fabric.variantId == null && !fabric.mint) {
        blocked.push({ legacyOrder: order.legacyOrder, vendorSku: fabric.vendorSku, reason: "variant not in Katana and not in the mint list" });
        continue;
      }
      if (fabric.predictedAvailability !== "NOT_AVAILABLE") {
        blocked.push({
          legacyOrder: order.legacyOrder,
          vendorSku: fabric.vendorSku,
          reason: "live stock covers this line, so Katana would not flag a shortage",
        });
      }
    }
  }

  const shellHit = index.get(SHELL_SKU) ?? null;
  const materialsToMint = MINTS.filter((spec) => !index.has(spec.vendorSku)).map((spec) => spec.vendorSku);
  const proposedHubAliases = MINTS.map((spec) => ({
    vendorSku: spec.vendorSku,
    proposedHubSku: spec.proposedHubSku,
    unused: !index.has(spec.proposedHubSku),
  }));
  const missingResources = [
    ...new Set(
      orders.flatMap((order) =>
        order.operations.filter((op) => resources.size > 0 && op.resourceId == null).map((op) => op.resource),
      ),
    ),
  ];
  for (const resource of missingResources) {
    localExceptions.push({ legacyOrder: "", vendorSku: "", reason: `Resource "${resource}" was not returned by GET /resources` });
  }

  const recipeRows = orders.reduce(
    (sum, order) => sum + order.fabrics.filter((fabric) => fabric.disposition === "recipe-row").length,
    0,
  );
  const outOfStockLines = orders.reduce(
    (sum, order) => sum + order.fabrics.filter((fabric) => fabric.sheetStatus.toUpperCase() === "OUT OF STOCK").length,
    0,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "confirm-planned" : "dry-run",
    relieveHold,
    locationId: CC_MANUFACTURING_LOCATION_ID,
    holdOrderNo: FABRIC_HOLD_ORDER_NO,
    mtoBranch: "empty-shell",
    scope: {
      salesOrders: orders.length,
      openUniverse: openRows.length,
      excludedCompleted,
      exceptions: statusExceptions.length,
      orderFilter,
    },
    summary: {
      salesOrders: orders.length,
      excludedCompleted,
      statusExceptions: statusExceptions.length,
      recipeRows,
      outOfStockLines,
      predictedNotAvailable: orders.reduce(
        (sum, order) =>
          sum +
          order.fabrics.filter(
            (fabric) =>
              fabric.sheetStatus.toUpperCase() === "OUT OF STOCK" &&
              fabric.predictedAvailability === "NOT_AVAILABLE",
          ).length,
        0,
      ),
      blocked: blocked.length,
      materialsToMint: materialsToMint.length,
      holdOverlap: holdOverlap.length,
      existingSalesOrders: orders.filter((order) => order.existingSalesOrderId).length,
      shell: shellHit ? "exists" : "would-create",
    },
    shell: {
      sku: SHELL_SKU,
      action: shellHit ? "exists" : "would-create",
      variantId: shellHit?.variantId ?? null,
    },
    materialsToMint,
    proposedHubAliases,
    resourcesResolved: resources.size > 0,
    missingResources,
    orders: orders.map((order) => ({
      legacyOrder: order.legacyOrder,
      katanaOrderNo: order.katanaOrderNo,
      customer: order.customer,
      orderStatus: order.orderStatus,
      additionalInfo: order.additionalInfo,
      existingSalesOrderId: order.existingSalesOrderId,
      productionDeadline: order.productionDeadline,
      moStatus: order.moStatus,
      operations: order.operations.map((op) => ({
        resource: op.resource,
        operationName: op.operationName,
        status: op.status,
        plannedTimeSeconds: op.plannedTimeSeconds,
        resourceId: op.resourceId,
      })),
      fabrics: order.fabrics.map((fabric) => ({
        vendorSku: fabric.vendorSku,
        hubSku: fabric.hubSku,
        name: fabric.name,
        yards: fabric.yards,
        sheetStatus: fabric.sheetStatus,
        disposition: fabric.disposition,
        predictedAvailability: fabric.predictedAvailability,
        variantId: fabric.variantId,
        resolvedSku: fabric.resolvedSku,
        mint: fabric.mint,
        katana: fabric.katana,
        sheetStock: fabric.sheetStock,
        sheetDifference: fabric.sheetDifference,
        dateIntro: fabric.dateIntro,
        preFreeze: fabric.preFreeze,
        client: fabric.client,
      })),
    })),
    shortageGate: {
      expected: outOfStockLines,
      predictedNotAvailable: orders.reduce(
        (sum, order) =>
          sum +
          order.fabrics.filter(
            (fabric) =>
              fabric.sheetStatus.toUpperCase() === "OUT OF STOCK" &&
              fabric.predictedAvailability === "NOT_AVAILABLE",
          ).length,
        0,
      ),
      blocked,
    },
    holdOverlap,
    exceptions: [...statusExceptions.map((row) => ({ ...row, vendorSku: "", reason: row.status })), ...localExceptions],
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(DRY_RUN_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${DRY_RUN_PATH}`);
  console.log(JSON.stringify(report.summary, null, 2));
  const noteSamples = orderFilter
    ? orders
    : [
        orders.find((order) => order.legacyOrder === "1769"),
        orders.find((order) => /Proj\. Hrs Cushion: (?!—)/.test(order.additionalInfo)),
      ].filter((order): order is PlannedOrder => order != null);
  for (const order of noteSamples) {
    console.log(`\n--- additional_info ${order.katanaOrderNo} ---\n${order.additionalInfo}`);
  }
  if (blocked.length > 0) {
    console.log("Shortage gate blockers:");
    for (const block of blocked) console.log(`  ${block.legacyOrder} ${block.vendorSku}: ${block.reason}`);
  }

  if (!confirm) return;
  await executeLive({ orders, index, hold, blocked });
  console.log(`Ledger ${LEDGER_PATH}`);
}

main().catch((error: unknown) => {
  if (error instanceof KatanaApiError && error.details != null) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
