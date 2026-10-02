/**
 * One-time physical inventory cutover into Katana.
 *
 * Phase 3: POST /stocktakes with counted_quantity (absolute). Every payload
 * sets set_remaining_items_as_counted: true. This script never calls
 * POST /stock_adjustments.
 *
 * Phase 4: after those stocktakes are COMPLETED, POST /sales_orders
 * MIG-HOLD-FABRIC-20260811 for fabric FOR CUSTOMER yards.
 *
 * Dry-run is the default. Live HTTP writes require --confirm.
 * Completed numbers in data_migration/reports/applied.json are skipped.
 *
 *   npm run ops:execute-inventory-migration
 *   npm run ops:execute-inventory-migration:confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, like, or } from "drizzle-orm";
import { GLOBAL_E2E_SKU_SET } from "../../src/generated/global-e2e-skus";
import {
  KatanaApiError,
  createIntervalPacer,
  ensureKatanaVariantForSku,
  findVariantBySku,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import { sku_aliases, sku_mappings } from "../../src/server/db/schema";
import {
  REQUEST_DELAY_MS,
  parseCsvLine,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";
import { paginateKatana } from "./lib/katana-paginate";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const CHUNK_MAX = 250;
const HOLD_ORDER_NO = "MIG-HOLD-FABRIC-20260811";
const HOLD_CUSTOMER = "Sheet Migration Hold";
const EXPECTED_HOLD_SKUS = 99;
const EXPECTED_HOLD_YARDS = 2846.7;
const REPORT_DIR = join(process.cwd(), "data_migration", "reports");
const LEDGER_PATH = join(REPORT_DIR, "applied.json");

const FABRIC_PREFIX = "MIG-STK-FABRIC-20260811";
const DEKTON_PREFIX = "MIG-STK-DEKTON-20260723";
const FIREPIT_PREFIX = "MIG-STK-FIREPIT";

type Family = "fabric" | "dekton" | "firepit";

type CountLine = {
  family: Family;
  sku: string;
  bin: string | null;
  quantity: number;
  reserved: number;
};

type StocktakePlan = {
  stocktakeNumber: string;
  family: Family;
  rows: CountLine[];
};

type LedgerStocktake = {
  stocktakeNumber: string;
  id: number | null;
  status: "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED";
  rowCount: number;
};

type LedgerHold = {
  orderNo: string;
  id: number | null;
  status: "COMPLETED";
  customerId: number | null;
  skuCount: number;
  yards: number;
};

type Ledger = {
  updatedAt: string;
  locationId: number | null;
  stocktakes: LedgerStocktake[];
  holdOrder: LedgerHold | null;
};

type HubRow = {
  sku: string;
  name: string;
  variantId: number | null;
  materialId: number | null;
};

function norm(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(value: string | undefined): number {
  const parsed = Number(String(value ?? "").trim() || "0");
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.round(parsed * 10000) / 10000;
}

function thickSuffix(raw: string): string | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  if (Math.abs(parsed - 1.2) < 0.01) return "1.2";
  if (Math.abs(parsed - 2) < 0.01) return "2.0";
  return String(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapEntity(data: unknown): Record<string, unknown> {
  const record = asRecord(data);
  if (!record) return {};
  if (record.id != null) return record;
  return asRecord(record.data) ?? record;
}

function readLedger(): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Partial<Ledger>;
    return {
      updatedAt: parsed.updatedAt ?? "",
      locationId: parsed.locationId ?? null,
      stocktakes: Array.isArray(parsed.stocktakes) ? parsed.stocktakes : [],
      holdOrder: parsed.holdOrder ?? null,
    };
  } catch {
    return { updatedAt: "", locationId: null, stocktakes: [], holdOrder: null };
  }
}

function writeLedger(ledger: Ledger): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function findCsv(part: string): string {
  const dir = join(process.cwd(), "data_migration");
  const hit = readdirSync(dir).find(
    (name) => name.toLowerCase().includes(part.toLowerCase()) && name.endsWith(".csv"),
  );
  if (!hit) throw new Error(`No CSV in data_migration matching "${part}"`);
  return join(dir, hit);
}

function readCsvFromHeader(path: string, headerIncludes: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.includes(headerIncludes));
  if (headerIdx < 0) {
    throw new Error(`${path} has no header containing ${headerIncludes}`);
  }
  const headers = parseCsvLine(lines[headerIdx]!).map((cell) => cell.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]!] = (cols[i] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

type Indexes = {
  bySku: Map<string, HubRow>;
  alias: Map<string, string>;
  fabricByName: Map<string, string[]>;
  dektonByName: Map<string, string[]>;
  firepitByCode: Map<string, string>;
};

async function loadIndexes(): Promise<Indexes> {
  const db = getDb();
  const mappings = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      variantId: sku_mappings.katana_variant_id,
      materialId: sku_mappings.katana_material_id,
      active: sku_mappings.is_active,
    })
    .from(sku_mappings)
    .where(
      or(
        eq(sku_mappings.is_active, true),
        like(sku_mappings.global_sku, "FRP-HPC-%"),
      ),
    );
  const aliases = await db
    .select({
      alias: sku_aliases.alias_sku,
      canonical: sku_aliases.canonical_sku,
    })
    .from(sku_aliases);

  const bySku = new Map<string, HubRow>();
  const fabricByName = new Map<string, string[]>();
  const dektonByName = new Map<string, string[]>();
  const firepitByCode = new Map<string, string>();

  for (const row of mappings) {
    const sku = row.sku.trim().toUpperCase();
    bySku.set(sku, {
      sku,
      name: row.name ?? "",
      variantId: row.variantId ?? null,
      materialId: row.materialId ?? null,
    });
    const nameKey = norm(row.name ?? "");
    if (!nameKey) continue;
    if (sku.startsWith("FAB-")) {
      const list = fabricByName.get(nameKey) ?? [];
      list.push(sku);
      fabricByName.set(nameKey, list);
    } else if (sku.startsWith("STN-DKT-")) {
      const list = dektonByName.get(nameKey) ?? [];
      list.push(sku);
      dektonByName.set(nameKey, list);
    } else if (sku.startsWith("FRP-HPC-")) {
      firepitByCode.set(sku.slice("FRP-HPC-".length), sku);
    }
  }

  const alias = new Map<string, string>();
  for (const row of aliases) {
    const canonical = row.canonical.trim().toUpperCase();
    if (!bySku.has(canonical)) continue;
    alias.set(norm(row.alias), canonical);
  }

  return { bySku, alias, fabricByName, dektonByName, firepitByCode };
}

function uniqueName(map: Map<string, string[]>, key: string): string | null {
  const hits = map.get(key) ?? [];
  return hits.length === 1 ? hits[0]! : null;
}

function acceptSku(indexes: Indexes, sku: string | null): string | null {
  if (!sku) return null;
  const upper = sku.trim().toUpperCase();
  if (!indexes.bySku.has(upper)) return null;
  return upper;
}

function resolveDekton(indexes: Indexes, type: string, thickness: string): string | null {
  const suffix = thickSuffix(thickness);
  if (!suffix) return null;
  const full = norm(`${type} ${suffix}`);
  const bare = norm(type);
  const fromFull =
    acceptSku(indexes, indexes.alias.get(full) ?? null) ??
    uniqueName(indexes.dektonByName, full);
  if (fromFull) return fromFull;
  const fromBare = acceptSku(indexes, indexes.alias.get(bare) ?? null);
  if (fromBare && fromBare.endsWith(suffix)) return fromBare;
  return null;
}

function resolveFabric(indexes: Indexes, name: string): string | null {
  const key = norm(name);
  return (
    uniqueName(indexes.fabricByName, key) ??
    acceptSku(indexes, indexes.alias.get(key) ?? null)
  );
}

function resolveFirepit(indexes: Indexes, code: string): string | null {
  const stripped = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!stripped) return null;
  return (
    indexes.firepitByCode.get(stripped) ??
    acceptSku(indexes, indexes.alias.get(norm(code)) ?? null) ??
    acceptSku(indexes, indexes.alias.get(stripped) ?? null)
  );
}

function assertDictionary(sku: string, warnings: string[]): void {
  if (GLOBAL_E2E_SKU_SET.has(sku)) return;
  warnings.push(
    `${sku} is in sku_mappings and not in global-e2e-skus.ts (seeded after the dictionary was generated).`,
  );
}

type Parsed = {
  lines: CountLine[];
  hold: Map<string, number>;
  balanceBreaks: string[];
  unmapped: string[];
  dictionaryWarnings: string[];
};

function parseInventories(indexes: Indexes): Parsed {
  const lines: CountLine[] = [];
  const balanceBreaks: string[] = [];
  const unmapped: string[] = [];
  const dictionaryWarnings: string[] = [];
  const seenWarn = new Set<string>();

  const fabricRows = readCsvRecords(findCsv("Fabric"));
  for (const row of fabricRows) {
    const name = (row.FABRIC ?? "").trim();
    if (!name) continue;
    if (norm(name) === "COAST NAVAL BLUE") continue;
    const entries = num(row["TOTAL ENTRIES"]);
    const outputs = num(row["TOTAL OUTPUTS"]);
    const reserved = num(row["FOR CUSTOMER"]);
    const available = num(row["STOCK AVAILABLE"]);
    if ([entries, outputs, reserved, available].some((value) => Number.isNaN(value))) {
      balanceBreaks.push(`${name}: non-numeric quantity`);
      continue;
    }
    const physical = Math.round((entries - outputs) * 10000) / 10000;
    const cross = Math.round((available + reserved) * 10000) / 10000;
    if (Math.abs(physical - cross) > 0.001) {
      balanceBreaks.push(
        `${name} bin ${row.BIN || "—"}: entries-outputs=${physical} available+for_customer=${cross}`,
      );
      continue;
    }
    if (physical < 0) {
      balanceBreaks.push(`${name} bin ${row.BIN || "—"}: negative physical ${physical}`);
      continue;
    }
    const sku = resolveFabric(indexes, name);
    if (!sku) {
      if (physical > 0 || reserved > 0) {
        unmapped.push(`fabric ${name} physical=${physical} reserved=${reserved}`);
      }
      continue;
    }
    if (!seenWarn.has(sku)) {
      seenWarn.add(sku);
      assertDictionary(sku, dictionaryWarnings);
    }
    lines.push({
      family: "fabric",
      sku,
      bin: (row.BIN ?? "").trim() || null,
      quantity: physical,
      reserved,
    });
  }

  const dektonRows = readCsvRecords(findCsv("DEKTON"));
  for (const row of dektonRows) {
    const type = (row.TYPE ?? "").trim();
    if (!type) continue;
    const quantity = num(row.QTY);
    const suffix = thickSuffix(row.THICKNESS ?? "");
    if (Number.isNaN(quantity) || quantity < 0 || !suffix) {
      balanceBreaks.push(`dekton ${type}: bad qty/thickness`);
      continue;
    }
    const sku = resolveDekton(indexes, type, row.THICKNESS ?? "");
    if (!sku) {
      if (quantity > 0) unmapped.push(`dekton ${type} ${suffix} qty=${quantity}`);
      continue;
    }
    if (!seenWarn.has(sku)) {
      seenWarn.add(sku);
      assertDictionary(sku, dictionaryWarnings);
    }
    lines.push({
      family: "dekton",
      sku,
      bin: (row.LOCATION ?? "").trim() || null,
      quantity,
      reserved: 0,
    });
  }

  const firepitRows = readCsvFromHeader(findCsv("FIREPIT"), "Total on Hand");
  for (const row of firepitRows) {
    const code = (row.Code ?? "").trim();
    if (!code) continue;
    const quantity = num(row["Total on Hand"]);
    if (Number.isNaN(quantity) || quantity < 0) {
      balanceBreaks.push(`firepit ${code}: bad quantity`);
      continue;
    }
    const sku = resolveFirepit(indexes, code);
    if (!sku) {
      if (quantity > 0) unmapped.push(`firepit ${code} qty=${quantity}`);
      continue;
    }
    if (!seenWarn.has(sku)) {
      seenWarn.add(sku);
      assertDictionary(sku, dictionaryWarnings);
    }
    lines.push({
      family: "firepit",
      sku,
      bin: null,
      quantity,
      reserved: 0,
    });
  }

  const rugPath = findCsv("Rug");
  const rugRows = readCsvRecords(rugPath);
  const rugFilled = rugRows.some((row) =>
    ["BIN", "ITEM", "MODEL", "COUNT 1", "TOTAL COUNT"].some((key) => (row[key] ?? "").trim()),
  );
  if (rugFilled) {
    throw new Error(
      "Rug CSV contains item data. This script does not load rugs. Export was expected empty.",
    );
  }
  console.log("RUG_EXPORT_EMPTY: rug print layout has no counts. Rug stock will not be changed.");

  return {
    lines: collapseLines(lines),
    hold: holdFrom(lines),
    balanceBreaks,
    unmapped,
    dictionaryWarnings,
  };
}

function collapseLines(lines: CountLine[]): CountLine[] {
  const grouped = new Map<string, CountLine>();
  for (const line of lines) {
    const key = `${line.family}|${line.sku}|${line.bin ?? ""}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...line });
      continue;
    }
    existing.quantity = Math.round((existing.quantity + line.quantity) * 10000) / 10000;
    existing.reserved = Math.round((existing.reserved + line.reserved) * 10000) / 10000;
  }
  return [...grouped.values()].sort((a, b) => {
    const family = a.family.localeCompare(b.family);
    if (family !== 0) return family;
    const sku = a.sku.localeCompare(b.sku);
    if (sku !== 0) return sku;
    return (a.bin ?? "").localeCompare(b.bin ?? "");
  });
}

function holdFrom(lines: CountLine[]): Map<string, number> {
  const hold = new Map<string, number>();
  for (const line of lines) {
    if (line.family !== "fabric" || line.reserved <= 0) continue;
    hold.set(
      line.sku,
      Math.round(((hold.get(line.sku) ?? 0) + line.reserved) * 10000) / 10000,
    );
  }
  return hold;
}

function packPlans(lines: CountLine[]): StocktakePlan[] {
  const plans: StocktakePlan[] = [];
  const families: Array<{ family: Family; prefix: string }> = [
    { family: "fabric", prefix: FABRIC_PREFIX },
    { family: "dekton", prefix: DEKTON_PREFIX },
    { family: "firepit", prefix: FIREPIT_PREFIX },
  ];
  for (const { family, prefix } of families) {
    const familyLines = lines.filter((line) => line.family === family);
    const chunks = chunkByVariant(familyLines);
    chunks.forEach((rows, index) => {
      plans.push({
        stocktakeNumber: `${prefix}-${index + 1}`,
        family,
        rows,
      });
    });
  }
  return plans;
}

function chunkByVariant(lines: CountLine[]): CountLine[][] {
  const groups = new Map<string, CountLine[]>();
  for (const line of lines) {
    const group = groups.get(line.sku) ?? [];
    group.push(line);
    groups.set(line.sku, group);
  }
  const chunks: CountLine[][] = [];
  let current: CountLine[] = [];
  for (const group of groups.values()) {
    if (group.length > CHUNK_MAX) {
      throw new Error(`${group[0]?.sku} has ${group.length} bin rows, above the 250 row cap.`);
    }
    if (current.length + group.length > CHUNK_MAX && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) chunks.push(current);
  for (const chunk of chunks) {
    if (chunk.length > CHUNK_MAX) {
      throw new Error(`Stocktake chunk has ${chunk.length} rows (max ${CHUNK_MAX}).`);
    }
  }
  return chunks;
}

function assertHold(hold: Map<string, number>): number {
  let yards = 0;
  for (const quantity of hold.values()) yards += quantity;
  yards = Math.round(yards * 10000) / 10000;
  if (hold.size !== EXPECTED_HOLD_SKUS || Math.abs(yards - EXPECTED_HOLD_YARDS) > 0.001) {
    throw new Error(
      `Fabric hold is ${hold.size} SKUs / ${yards} yards. Expected ${EXPECTED_HOLD_SKUS} / ${EXPECTED_HOLD_YARDS}.`,
    );
  }
  return yards;
}

type LocationHit = { id: number; name?: string | null; is_primary?: boolean | null };
type BinHit = { id: number; bin_name?: string | null; location_id?: number | null };

async function primaryLocation(): Promise<LocationHit> {
  const { data } = await katanaFetch("/locations?limit=50&page=1");
  const rows = unwrapList<LocationHit>(data);
  const location =
    rows.find((row) => row.is_primary === true) ??
    rows.find((row) => /primary|main|factory|manufactur/i.test(row.name ?? "")) ??
    rows[0];
  if (!location?.id) throw new Error("No Katana location found.");
  return location;
}

async function loadBins(locationId: number): Promise<{ bins: BinHit[]; blocked: boolean }> {
  try {
    const rows = await paginateKatana(`/bin_locations?location_id=${locationId}`, "bins", {
      quiet: true,
    });
    return {
      blocked: false,
      bins: rows.map((row) => ({
        id: Number(row.id),
        bin_name: row.bin_name == null ? null : String(row.bin_name),
        location_id: row.location_id == null ? null : Number(row.location_id),
      })),
    };
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && (error.status === 403 || error.status === 404)) {
      console.log("bin_locations unavailable. Stocktakes will sum bins onto the warehouse location.");
      return { bins: [], blocked: true };
    }
    throw error;
  }
}

async function ensureBin(
  bins: BinHit[],
  locationId: number,
  binName: string,
): Promise<number> {
  const existing = bins.find((bin) => norm(bin.bin_name ?? "") === norm(binName));
  if (existing?.id) return existing.id;
  if (!confirm) {
    console.log(`  would POST /bin_locations ${binName}`);
    return 0;
  }
  const { data } = await katanaFetch<Record<string, unknown>>("/bin_locations", {
    method: "POST",
    body: { bin_name: binName, location_id: locationId },
  });
  const created = unwrapEntity(data);
  const id = Number(created.id);
  if (!Number.isFinite(id)) throw new Error(`Bin ${binName} was created without an id.`);
  bins.push({ id, bin_name: binName, location_id: locationId });
  console.log(`  created bin ${binName} id=${id}`);
  return id;
}

async function ensureFirepitVariants(
  lines: CountLine[],
  indexes: Indexes,
  cache: Map<string, number>,
): Promise<void> {
  const skus = [
    ...new Set(lines.filter((line) => line.family === "firepit").map((line) => line.sku)),
  ].sort();
  for (const sku of skus) {
    const stored = indexes.bySku.get(sku)?.variantId;
    if (stored && stored > 0) {
      cache.set(sku, stored);
      continue;
    }
    if (!confirm) {
      console.log(`  would ensure Katana variant for inactive/unpublished ${sku}`);
      continue;
    }
    const result = await ensureKatanaVariantForSku(sku);
    if (!result.ok) {
      throw new Error(`Katana variant for ${sku} failed: ${result.error}`);
    }
    cache.set(sku, result.variantId);
    const hub = indexes.bySku.get(sku);
    if (hub) hub.variantId = result.variantId;
    console.log(`  variant ${sku} → ${result.variantId} (${result.action})`);
  }
}

async function variantIdFor(line: CountLine, indexes: Indexes, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(line.sku);
  if (cached) return cached;
  const stored = indexes.bySku.get(line.sku)?.variantId;
  if (stored && stored > 0) {
    cache.set(line.sku, stored);
    return stored;
  }
  const variant = await findVariantBySku(line.sku);
  if (!variant) {
    throw new Error(`${line.sku} has no Katana variant. Publish the material before the stocktake.`);
  }
  cache.set(line.sku, variant.id);
  return variant.id;
}

async function findStocktake(stocktakeNumber: string): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/stocktakes?stocktake_number=${encodeURIComponent(stocktakeNumber)}&limit=5`,
  );
  const rows = unwrapList<Record<string, unknown>>(data);
  return (
    rows.find((row) => String(row.stocktake_number ?? "") === stocktakeNumber) ?? null
  );
}

async function getStocktake(id: number): Promise<Record<string, unknown>> {
  const { data } = await katanaFetch(`/stocktakes?ids=${id}&limit=5`);
  const rows = unwrapList<Record<string, unknown>>(data);
  const hit = rows.find((row) => Number(row.id) === id);
  if (!hit) throw new Error(`Stocktake ${id} was not returned by GET /stocktakes?ids=.`);
  return hit;
}

async function waitUntil(
  id: number,
  accepted: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  let latest: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 40; attempt += 1) {
    latest = await getStocktake(id);
    const status = String(latest.status ?? "");
    const busy = latest.status_update_in_progress === true;
    if (accepted.has(status) && !busy) return latest;
    if (status === "COMPLETED" && !busy) return latest;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Stocktake ${id} stayed ${String(latest.status ?? "unknown")} (status_update_in_progress=${String(latest.status_update_in_progress)}).`,
  );
}

async function patchStocktakeStatus(
  id: number,
  status: "IN_PROGRESS" | "COUNTED" | "COMPLETED",
): Promise<void> {
  const body: Record<string, unknown> = {
    status,
    set_remaining_items_as_counted: true,
  };
  if (status === "COMPLETED") {
    body.completed_date = new Date().toISOString();
  }
  await katanaFetch(`/stocktakes/${id}`, {
    method: "PATCH",
    body,
  });
}

function stocktakePayload(
  plan: StocktakePlan,
  locationId: number,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const payload = {
    stocktake_number: plan.stocktakeNumber,
    location_id: locationId,
    reason: "Physical inventory migration from frozen sheets",
    created_date: new Date().toISOString().slice(0, 10),
    set_remaining_items_as_counted: true as const,
    stocktake_rows: rows,
  };
  if (payload.set_remaining_items_as_counted !== true) {
    throw new Error("set_remaining_items_as_counted must be true.");
  }
  if (payload.stocktake_rows.length > CHUNK_MAX) {
    throw new Error(`${plan.stocktakeNumber} has ${payload.stocktake_rows.length} rows.`);
  }
  return payload;
}

async function buildStocktakeRows(
  plan: StocktakePlan,
  indexes: Indexes,
  cache: Map<string, number>,
  bins: BinHit[],
  locationId: number,
  binsBlocked: boolean,
): Promise<Array<Record<string, unknown>>> {
  if (binsBlocked) {
    const bySku = new Map<string, { quantity: number; bins: string[] }>();
    for (const line of plan.rows) {
      const current = bySku.get(line.sku) ?? { quantity: 0, bins: [] };
      current.quantity = Math.round((current.quantity + line.quantity) * 10000) / 10000;
      if (line.bin) current.bins.push(`${line.bin}=${line.quantity}`);
      bySku.set(line.sku, current);
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const [sku, rolled] of bySku) {
      const variantId = await variantIdFor(
        { family: plan.family, sku, bin: null, quantity: rolled.quantity, reserved: 0 },
        indexes,
        cache,
      );
      rows.push({
        variant_id: variantId,
        counted_quantity: rolled.quantity,
        notes: rolled.bins.join(", ").slice(0, 540) || sku,
      });
    }
    return rows;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const line of plan.rows) {
    const variantId = await variantIdFor(line, indexes, cache);
    const row: Record<string, unknown> = {
      variant_id: variantId,
      counted_quantity: line.quantity,
      notes: `${line.sku}${line.bin ? ` bin ${line.bin}` : ""}`.slice(0, 540),
    };
    if (line.bin) {
      const binId = await ensureBin(bins, locationId, line.bin);
      if (binId > 0) row.bin_location_id = binId;
    }
    rows.push(row);
  }
  return rows;
}

async function completeStocktake(plan: StocktakePlan, locationId: number, rows: Array<Record<string, unknown>>, ledger: Ledger): Promise<void> {
  const prior = ledger.stocktakes.find((row) => row.stocktakeNumber === plan.stocktakeNumber);
  if (prior?.status === "COMPLETED") {
    console.log(
      `  skip ${plan.stocktakeNumber} COMPLETED id=${prior.id ?? "?"} rows=${prior.rowCount}`,
    );
    if (prior.rowCount !== rows.length) {
      console.log(
        `  warning: ledger row count ${prior.rowCount} differs from this plan (${rows.length}). Not reposting.`,
      );
    }
    return;
  }

  let existing = await findStocktake(plan.stocktakeNumber);
  let id = existing?.id == null ? null : Number(existing.id);
  let status = String(existing?.status ?? "");

  if (!existing) {
    const payload = stocktakePayload(plan, locationId, rows);
    console.log(
      `  POST /stocktakes ${plan.stocktakeNumber} rows=${rows.length} set_remaining_items_as_counted=true`,
    );
    const { data } = await katanaFetch("/stocktakes", {
      method: "POST",
      body: payload,
      idempotencyKey: plan.stocktakeNumber,
    });
    existing = unwrapEntity(data);
    id = Number(existing.id);
    status = String(existing.status ?? "NOT_STARTED");
  }

  if (!id || !Number.isFinite(id)) {
    throw new Error(`${plan.stocktakeNumber} has no Katana id.`);
  }
  console.log(`  ${plan.stocktakeNumber} id=${id} status=${status || "unknown"}`);

  if (status === "NOT_STARTED" || status === "") {
    await patchStocktakeStatus(id, "IN_PROGRESS");
    const started = await waitUntil(id, new Set(["IN_PROGRESS", "COUNTED", "COMPLETED"]));
    status = String(started.status ?? "");
    console.log(`  ${plan.stocktakeNumber} → ${status}`);
  }
  if (status === "IN_PROGRESS") {
    await patchStocktakeStatus(id, "COUNTED");
    const counted = await waitUntil(id, new Set(["COUNTED", "COMPLETED"]));
    status = String(counted.status ?? "");
    console.log(`  ${plan.stocktakeNumber} → ${status}`);
  }
  if (status === "COUNTED") {
    await patchStocktakeStatus(id, "COMPLETED");
    const done = await waitUntil(id, new Set(["COMPLETED"]));
    status = String(done.status ?? "");
    console.log(`  ${plan.stocktakeNumber} → ${status}`);
  }

  if (status !== "COMPLETED") {
    throw new Error(`${plan.stocktakeNumber} finished as ${status}, not COMPLETED.`);
  }

  const next = ledger.stocktakes.filter((row) => row.stocktakeNumber !== plan.stocktakeNumber);
  next.push({
    stocktakeNumber: plan.stocktakeNumber,
    id,
    status: "COMPLETED",
    rowCount: rows.length,
  });
  ledger.stocktakes = next;
  ledger.locationId = locationId;
  writeLedger(ledger);
}

async function findCustomerId(): Promise<number | null> {
  const rows = await paginateKatana("/customers", "customers", { quiet: true, maxPages: 20 });
  const hit = rows.find(
    (row) => String(row.name ?? "").trim().toLowerCase() === HOLD_CUSTOMER.toLowerCase(),
  );
  const id = Number(hit?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function ensureCustomer(): Promise<number> {
  const existing = await findCustomerId();
  if (existing) {
    console.log(`  customer "${HOLD_CUSTOMER}" id=${existing}`);
    return existing;
  }
  if (!confirm) {
    console.log(`  would POST /customers name="${HOLD_CUSTOMER}"`);
    return 0;
  }
  const { data } = await katanaFetch("/customers", {
    method: "POST",
    body: { name: HOLD_CUSTOMER },
  });
  const id = Number(unwrapEntity(data).id);
  if (!Number.isFinite(id)) throw new Error("Sheet Migration Hold customer was created without an id.");
  console.log(`  created customer "${HOLD_CUSTOMER}" id=${id}`);
  return id;
}

async function findHoldOrder(): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/sales_orders?order_no=${encodeURIComponent(HOLD_ORDER_NO)}&limit=5`,
  );
  const rows = unwrapList<Record<string, unknown>>(data);
  return rows.find((row) => String(row.order_no ?? "") === HOLD_ORDER_NO) ?? null;
}

async function ensureFabricSellable(
  sku: string,
  variantId: number,
  indexes: Indexes,
): Promise<void> {
  const hub = indexes.bySku.get(sku);
  let materialId = hub?.materialId ?? null;
  if (materialId == null || materialId <= 0) {
    const { data } = await katanaFetch(`/variants/${variantId}`);
    const raw = unwrapEntity(data).material_id;
    materialId = raw == null ? null : Number(raw);
    if (hub && materialId != null && materialId > 0) hub.materialId = materialId;
  }
  if (materialId == null || !Number.isFinite(materialId) || materialId <= 0) {
    throw new Error(
      `${sku} variant ${variantId} is not a Katana material. Sales orders cannot commit it.`,
    );
  }
  if (!confirm) {
    console.log(`  would PATCH /materials/${materialId} is_sellable=true (${sku})`);
    return;
  }
  await katanaFetch(`/materials/${materialId}`, {
    method: "PATCH",
    body: { is_sellable: true },
  });
}

async function createHoldOrder(
  hold: Map<string, number>,
  yards: number,
  indexes: Indexes,
  cache: Map<string, number>,
  locationId: number,
  ledger: Ledger,
): Promise<void> {
  if (ledger.holdOrder?.status === "COMPLETED" && ledger.holdOrder.orderNo === HOLD_ORDER_NO) {
    console.log(
      `  skip ${HOLD_ORDER_NO} COMPLETED id=${ledger.holdOrder.id ?? "?"} skus=${ledger.holdOrder.skuCount}`,
    );
    return;
  }

  const existing = await findHoldOrder();
  if (existing?.id != null) {
    ledger.holdOrder = {
      orderNo: HOLD_ORDER_NO,
      id: Number(existing.id),
      status: "COMPLETED",
      customerId: existing.customer_id == null ? null : Number(existing.customer_id),
      skuCount: hold.size,
      yards,
    };
    writeLedger(ledger);
    console.log(`  ${HOLD_ORDER_NO} already exists id=${existing.id}. Not adding rows.`);
    return;
  }

  const customerId = await ensureCustomer();
  const salesOrderRows: Array<Record<string, unknown>> = [];
  const skus = [...hold.keys()].sort();
  for (const sku of skus) {
    const quantity = hold.get(sku)!;
    const variantId = await variantIdFor(
      { family: "fabric", sku, bin: null, quantity, reserved: quantity },
      indexes,
      cache,
    );
    await ensureFabricSellable(sku, variantId, indexes);
    if ((salesOrderRows.length + 1) % 25 === 0) {
      console.log(`  sellable ${salesOrderRows.length + 1}/${skus.length}`);
    }
    salesOrderRows.push({
      variant_id: variantId,
      quantity,
      price_per_unit: 0,
    });
  }

  console.log(
    `  POST /sales_orders ${HOLD_ORDER_NO} rows=${salesOrderRows.length} yards=${yards}`,
  );
  if (!confirm) return;

  const { data } = await katanaFetch("/sales_orders", {
    method: "POST",
    body: {
      order_no: HOLD_ORDER_NO,
      customer_id: customerId,
      location_id: locationId,
      currency: "USD",
      additional_info:
        "Fabric freeze 2026-08-11 FOR CUSTOMER hold. Commits reserved yards so they are not Available.",
      sales_order_rows: salesOrderRows,
    },
    idempotencyKey: `${HOLD_ORDER_NO}-sellable`,
  });
  const created = unwrapEntity(data);
  const id = Number(created.id);
  if (!Number.isFinite(id)) throw new Error(`${HOLD_ORDER_NO} was created without an id.`);
  ledger.holdOrder = {
    orderNo: HOLD_ORDER_NO,
    id,
    status: "COMPLETED",
    customerId,
    skuCount: salesOrderRows.length,
    yards,
  };
  writeLedger(ledger);
  console.log(`  created ${HOLD_ORDER_NO} id=${id}`);
}

async function main(): Promise<void> {
  setKatanaRequestPacer(createIntervalPacer(REQUEST_DELAY_MS));
  console.log("Execute inventory migration");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const indexes = await loadIndexes();
  const parsed = parseInventories(indexes);
  const yards = assertHold(parsed.hold);

  if (parsed.balanceBreaks.length > 0 || parsed.unmapped.length > 0) {
    for (const line of parsed.balanceBreaks) console.error(`  BALANCE_BREAK ${line}`);
    for (const line of parsed.unmapped) console.error(`  UNMAPPED ${line}`);
    throw new Error(
      `${parsed.balanceBreaks.length} balance breaks, ${parsed.unmapped.length} unmapped rows with quantity. No Katana writes.`,
    );
  }
  for (const warning of parsed.dictionaryWarnings) console.log(`  dictionary: ${warning}`);

  const plans = packPlans(parsed.lines);
  console.log(
    `  lines=${parsed.lines.length} stocktakes=${plans.length} hold=${parsed.hold.size} SKUs / ${yards} yards`,
  );
  for (const plan of plans) {
    console.log(`  plan ${plan.stocktakeNumber} ${plan.family} rows=${plan.rows.length}`);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    join(REPORT_DIR, "migration-preview.json"),
    `${JSON.stringify(
      {
        mode: confirm ? "live" : "dry-run",
        holdSkus: parsed.hold.size,
        holdYards: yards,
        stocktakes: plans.map((plan) => ({
          stocktakeNumber: plan.stocktakeNumber,
          family: plan.family,
          rows: plan.rows.length,
          set_remaining_items_as_counted: true,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const location = await primaryLocation();
  console.log(`  warehouse: ${location.name ?? location.id} id=${location.id}`);
  const binState = await loadBins(location.id);
  const ledger = readLedger();
  const cache = new Map<string, number>();

  const missingVariant = [
    ...new Set(parsed.lines.map((line) => line.sku)),
  ].filter((sku) => !(indexes.bySku.get(sku)?.variantId));
  console.log(`  SKUs with no stored katana_variant_id (resolved on --confirm): ${missingVariant.length}`);

  if (!confirm) {
    console.log("Dry-run only. Re-run with --confirm to POST stocktakes and the hold order.");
    for (const plan of plans) {
      const prior = ledger.stocktakes.find((row) => row.stocktakeNumber === plan.stocktakeNumber);
      if (prior?.status === "COMPLETED") {
        console.log(`  ledger already COMPLETED ${plan.stocktakeNumber} id=${prior.id ?? "?"}`);
      }
    }
    if (ledger.holdOrder?.status === "COMPLETED") {
      console.log(`  ledger already COMPLETED ${ledger.holdOrder.orderNo} id=${ledger.holdOrder.id ?? "?"}`);
    }
    return;
  }

  await ensureFirepitVariants(parsed.lines, indexes, cache);

  for (const plan of plans) {
    const prior = ledger.stocktakes.find((row) => row.stocktakeNumber === plan.stocktakeNumber);
    if (prior?.status === "COMPLETED") {
      console.log(
        `  skip ${plan.stocktakeNumber} COMPLETED id=${prior.id ?? "?"} rows=${prior.rowCount}`,
      );
      continue;
    }
    const rows = await buildStocktakeRows(
      plan,
      indexes,
      cache,
      binState.bins,
      location.id,
      binState.blocked,
    );
    await completeStocktake(plan, location.id, rows, ledger);
  }

  const unfinished = plans.filter((plan) => {
    const row = ledger.stocktakes.find((item) => item.stocktakeNumber === plan.stocktakeNumber);
    return row?.status !== "COMPLETED";
  });
  if (unfinished.length > 0) {
    throw new Error(
      `Hold order blocked until stocktakes complete: ${unfinished.map((plan) => plan.stocktakeNumber).join(", ")}`,
    );
  }

  await createHoldOrder(parsed.hold, yards, indexes, cache, location.id, ledger);
  console.log(`Ledger: ${LEDGER_PATH}`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? `\n${error.cause.message}` : "";
    console.error(`${message}${cause}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
