/**
 * Aluminum stick count → Katana stocktake at CC Manufacturing only.
 *
 * Feet = QTY_PCS × LENGTH_FT. Uploads every stick on the 2026-10-01 count
 * (10,800 ft). Previously weak matches and CHECK rows are minted as new
 * aluminum purchasing variants. Does not post recipe rows or purchase orders.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-metal-inventory.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-metal-inventory.ts --confirm
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
import { col, parseQty, readCsvRecords, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const STOCKTAKE_NUMBER = "MIG-METAL-COUNT-20261001";
const COUNT_PATH = join(process.cwd(), "data_migration", "METAL_ON_HAND_2026-10-01.csv");
const REPORT_PATH = join(process.cwd(), "data_migration", "reports", "metal-on-hand-dry-run.json");

const confirmRequested = process.argv.includes("--confirm");
const dryRunFlag = process.argv.includes("--dry-run");
const confirm = confirmRequested && !dryRunFlag;

type Disposition = "upload" | "mint" | "weak";

type Rule = {
  type: string;
  size: string;
  gauge: string;
  disposition: Disposition;
  sku: string;
  name: string;
};

const RULES: Rule[] = [
  { type: "SQUARE TUBE", size: "1x1", gauge: "16g", disposition: "upload", sku: "MET-TB11060", name: "1 X 1 X 16GA SQ TUBE" },
  { type: "RECT TUBE", size: "1-1/2x3/4", gauge: "16g", disposition: "upload", sku: "MET-TB11234060", name: "1-1/2 X 3/4 X 16GA REC TUBE" },
  { type: "RECT TUBE", size: "3x2", gauge: "16g", disposition: "upload", sku: "MET-TB32060", name: "3 X 2 X 16GA REC TUBE" },
  { type: "SQUARE TUBE", size: "2x2", gauge: "16g", disposition: "upload", sku: "MET-TB22060", name: "2 X 2 X 16GA SQ TUBE" },
  { type: "RECT TUBE", size: "2x3/4", gauge: "16g", disposition: "upload", sku: "MET-TB234060", name: "2 X 3/4 X 16GA REC TUBE" },
  { type: "RECT TUBE", size: "2x1", gauge: "16g", disposition: "upload", sku: "MET-TB21060", name: "2 X 1 X 16GA REC TUBE" },
  { type: "RECT TUBE", size: "4x2", gauge: "16g", disposition: "upload", sku: "MET-TB42060", name: "4 X 2 X 16GA REC TUBE" },
  { type: "ROUND BAR", size: "1/2", gauge: "SOLID", disposition: "upload", sku: "MET-RDH12", name: "1/2 HOT ROLLED ROUND SOLID" },
  { type: "FLAT BAR", size: "1x1/4", gauge: "", disposition: "upload", sku: "MET-FH141", name: "1/4 X 1 HR FLAT BAR" },
  { type: "FLAT BAR", size: "1-1/2x3/16", gauge: "", disposition: "upload", sku: "MET-FH316112", name: "3/16 X 1-1/2 HR FLAT BAR" },
  { type: "SQUARE TUBE", size: "2x2", gauge: "11g", disposition: "upload", sku: "MET-TB22120", name: "2 X 2 X 11GA SQ TUBE" },
  { type: "FLAT BAR", size: "2x3/16", gauge: "", disposition: "upload", sku: "MET-FH3162", name: "3/16 X 2 HR FLAT BAR" },
  { type: "ROUND TUBE", size: "3/4", gauge: "14g", disposition: "upload", sku: "MET-TBR34083", name: "3/4 X 14GA RD TUBE" },
  { type: "FLAT BAR", size: "1-1/2x1/8", gauge: "", disposition: "upload", sku: "MET-FH18112", name: "1/8 X 1-1/2 HR FLAT BAR" },
  { type: "FLAT BAR", size: "1x1/8", gauge: "", disposition: "mint", sku: "MET-FH181", name: "Aluminum Flat Bar 1 x 1/8" },
  { type: "SQUARE TUBE", size: "3x3", gauge: "16g", disposition: "mint", sku: "MET-TB33060", name: "Aluminum Square Tube 3x3 16g" },
  { type: "FLAT BAR", size: "2x1/4", gauge: "", disposition: "mint", sku: "MET-FH142", name: "Aluminum Flat Bar 2 x 1/4" },
  { type: "RECT TUBE", size: "2x1", gauge: "11g", disposition: "mint", sku: "MET-TB21120", name: "Aluminum Rect Tube 2x1 11g" },
  { type: "FLAT BAR", size: "1-1/2x3/4", gauge: "", disposition: "mint", sku: "MET-FH34112", name: "Aluminum Flat Bar 1-1/2 x 3/4" },
  { type: "SQUARE TUBE", size: "1-1/2x1-1/2", gauge: "16g", disposition: "mint", sku: "MET-TB112112060", name: "1-1/2 X 1-1/2 X 16GA SQ TUBE" },
  { type: "RECT TUBE", size: "1-1/2x3/4", gauge: "11g", disposition: "mint", sku: "MET-TB11234120", name: "1-1/2 X 3/4 X 11GA REC TUBE" },
  { type: "RECT TUBE", size: "3x1", gauge: "16g", disposition: "mint", sku: "MET-TB31060", name: "3 X 1 X 16GA REC TUBE" },
  { type: "FLAT BAR", size: "1-1/2x1/4", gauge: "", disposition: "mint", sku: "MET-FH14112", name: "1/4 X 1-1/2 HR FLAT BAR" },
  { type: "ROUND TUBE", size: "1", gauge: "14g", disposition: "mint", sku: "MET-TBR1083", name: "1 X 14GA RD TUBE" },
  { type: "RECT TUBE", size: "3x2", gauge: "11g", disposition: "mint", sku: "MET-TB32120", name: "3 X 2 X 11GA REC TUBE" },
  { type: "ROUND TUBE", size: "2", gauge: "14g", disposition: "mint", sku: "MET-TBR2083", name: "2 X 14GA RD TUBE" },
  { type: "ROUND TUBE", size: "1-1/2", gauge: "14g", disposition: "mint", sku: "MET-TBR112083", name: "1-1/2 X 14GA RD TUBE" },
  { type: "RECT TUBE", size: "1-1/2x1", gauge: "11g", disposition: "mint", sku: "MET-TB1121120", name: "1-1/2 X 1 X 11GA REC TUBE" },
  { type: "SQUARE TUBE", size: "1x1", gauge: "11g", disposition: "mint", sku: "MET-TB11120", name: "1 X 1 X 11GA SQ TUBE" },
  { type: "RECT TUBE", size: "4x2", gauge: "11g", disposition: "mint", sku: "MET-TB42120", name: "4 X 2 X 11GA REC TUBE" },
  { type: "FLAT BAR", size: "2x1/8", gauge: "", disposition: "mint", sku: "MET-FH182", name: "1/8 X 2 HR FLAT BAR" },
];

type CountLine = {
  type: string;
  size: string;
  gauge: string;
  pieces: number;
  lengthFt: number;
  feet: number;
  note: string;
  disposition: "upload" | "mint" | "weak" | "check";
  sku: string | null;
  name: string;
  variantId: number | null;
  liveOnHand: number | null;
  blocker: string | null;
};

function norm(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function ruleKey(type: string, size: string, gauge: string): string {
  return `${norm(type)}|${norm(size)}|${norm(gauge)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function roundFeet(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseCount(): CountLine[] {
  const rules = new Map(RULES.map((rule) => [ruleKey(rule.type, rule.size, rule.gauge), rule]));
  const seen = new Set<string>();
  const lines: CountLine[] = [];
  for (const row of readCsvRecords(COUNT_PATH)) {
    const type = col(row, "TYPE");
    const size = col(row, "SIZE_IN");
    const gauge = col(row, "GAUGE_OR_THICKNESS");
    const note = col(row, "NOTE");
    const pieces = parseQty(col(row, "QTY_PCS"));
    const lengthFt = parseQty(col(row, "LENGTH_FT"));
    if (!type || !size) throw new Error("Metal count row is missing TYPE or SIZE_IN.");
    if (pieces == null || pieces <= 0 || lengthFt == null || lengthFt <= 0) {
      throw new Error(`${type} ${size} ${gauge} has no positive piece count or length.`);
    }
    const key = ruleKey(type, size, gauge.replace(/\?/g, ""));
    if (seen.has(key)) throw new Error(`Duplicate metal profile ${type} ${size} ${gauge}.`);
    seen.add(key);
    const sheetCheck = note.toUpperCase().includes("CHECK") || gauge.includes("?");
    const rule = rules.get(key) ?? null;
    if (!rule && !sheetCheck) {
      throw new Error(`No rule for metal profile ${type} ${size} ${gauge || "(no gauge)"}.`);
    }
    lines.push({
      type,
      size,
      gauge,
      pieces,
      lengthFt,
      feet: roundFeet(pieces * lengthFt),
      note,
      disposition: rule ? rule.disposition : "check",
      sku: rule ? rule.sku : null,
      name: rule ? rule.name : "",
      variantId: null,
      liveOnHand: null,
      blocker: null,
    });
  }
  return lines;
}

async function liveOnHand(variantIds: number[]): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  if (variantIds.length === 0) return totals;
  const params = new URLSearchParams();
  params.set("limit", "250");
  for (const id of variantIds) params.append("variant_id", String(id));
  const { data } = await katanaFetch(`/inventory?${params.toString()}`);
  for (const row of unwrapList<Record<string, unknown>>(data)) {
    if (Number(row.location_id) !== CC_MANUFACTURING_LOCATION_ID) continue;
    const variantId = Number(row.variant_id);
    if (!Number.isFinite(variantId)) continue;
    const current = totals.get(variantId) ?? 0;
    totals.set(variantId, roundFeet(current + Number(row.quantity_in_stock ?? 0)));
  }
  return totals;
}

function stocktakePayload(lines: CountLine[]): Record<string, unknown> {
  const payload = {
    stocktake_number: STOCKTAKE_NUMBER,
    location_id: CC_MANUFACTURING_LOCATION_ID,
    reason: "Aluminum extrusion physical count 2026-10-01. Feet = sticks × length. Fabric and finished goods are not in this count.",
    created_date: "2026-10-01",
    set_remaining_items_as_counted: false as const,
    stocktake_rows: lines
      .filter((line) => line.disposition === "upload" || line.disposition === "mint")
      .map((line) => ({
        variant_id: line.variantId,
        sku: line.sku,
        counted_quantity: line.feet,
        notes: `${line.sku} ${line.pieces} sticks × ${line.lengthFt} ft`.slice(0, 540),
      })),
  };
  if (payload.set_remaining_items_as_counted !== false) {
    throw new Error("set_remaining_items_as_counted must be false.");
  }
  if (payload.location_id !== CC_MANUFACTURING_LOCATION_ID) {
    throw new Error("Metal stocktake is limited to CC Manufacturing.");
  }
  return payload;
}

async function mintMaterial(line: CountLine): Promise<number> {
  const sku = line.sku;
  if (!sku) throw new Error("Mint row has no SKU.");
  const { data } = await katanaFetch<Record<string, unknown>>("/materials", {
    method: "POST",
    idempotencyKey: `metal-mint:${sku}`,
    body: {
      name: line.name,
      uom: "ft",
      category_name: "Metal",
      is_sellable: false,
      variants: [{ sku }],
    },
  });
  const variant = asRecord(Array.isArray(data.variants) ? data.variants[0] : null);
  const variantId = Number(variant?.id);
  if (!Number.isFinite(variantId) || variantId <= 0) {
    throw new Error(`Katana created ${sku} without a variant id.`);
  }
  return variantId;
}

async function getStocktake(id: number): Promise<Record<string, unknown>> {
  const { data } = await katanaFetch(`/stocktakes?ids=${id}&limit=5`);
  const hit = unwrapList<Record<string, unknown>>(data).find((row) => Number(row.id) === id);
  if (!hit) throw new Error(`Stocktake ${id} was not returned.`);
  return hit;
}

async function patchStocktake(id: number, status: "IN_PROGRESS" | "COUNTED" | "COMPLETED"): Promise<void> {
  const body: Record<string, unknown> = {
    status,
    set_remaining_items_as_counted: false,
  };
  if (status === "COMPLETED") body.completed_date = new Date().toISOString();
  await katanaFetch(`/stocktakes/${id}`, { method: "PATCH", body });
}

async function finishStocktake(id: number): Promise<void> {
  let status = String((await getStocktake(id)).status ?? "");
  const steps: Array<"IN_PROGRESS" | "COUNTED" | "COMPLETED"> = ["IN_PROGRESS", "COUNTED", "COMPLETED"];
  for (const step of steps) {
    if (status === "COMPLETED") return;
    if (status === step) continue;
    const order = ["NOT_STARTED", "", "IN_PROGRESS", "COUNTED", "COMPLETED"];
    if (order.indexOf(status) > order.indexOf(step)) continue;
    await patchStocktake(id, step);
    const updated = await getStocktake(id);
    status = String(updated.status ?? "");
    console.log(`  stocktake ${id} → ${status}`);
  }
  if (status !== "COMPLETED") {
    throw new Error(`${STOCKTAKE_NUMBER} stopped at ${status || "unknown"}.`);
  }
}

async function findStocktake(): Promise<Record<string, unknown> | null> {
  const { data } = await katanaFetch(
    `/stocktakes?stocktake_number=${encodeURIComponent(STOCKTAKE_NUMBER)}&limit=5`,
  );
  const rows = unwrapList<Record<string, unknown>>(data);
  return rows.find((row) => String(row.stocktake_number ?? "") === STOCKTAKE_NUMBER) ?? null;
}

async function main(): Promise<void> {
  console.log(confirm ? "LIVE confirm. Metal stocktake writes are enabled." : "Dry-run. No Katana writes.");
  setKatanaRequestPacer(createIntervalPacer(1300));
  const lines = parseCount();
  const stockLines = lines.filter((line) => line.disposition === "upload" || line.disposition === "mint");

  for (const line of stockLines) {
    const found = await findVariantBySku(line.sku!);
    if (found) line.variantId = found.id;
  }

  const stock = await liveOnHand(
    stockLines.map((line) => line.variantId).filter((id): id is number => id != null),
  );
  for (const line of stockLines) {
    if (line.variantId == null) {
      if (line.disposition === "upload") {
        line.blocker = `${line.sku} is not in Katana`;
      }
      continue;
    }
    const onHand = stock.get(line.variantId) ?? 0;
    line.liveOnHand = onHand;
    if (onHand > 0.0001 && Math.abs(onHand - line.feet) > 0.01) {
      line.blocker = `${line.sku} already has ${onHand} ft at CC Manufacturing; this count is ${line.feet} ft`;
    }
  }

  const payload = stocktakePayload(lines);
  const blocked = lines.filter((line) => line.blocker);
  const summary = {
    countRows: lines.length,
    unambiguousExisting: lines.filter((line) => line.disposition === "upload").length,
    toMint: lines.filter((line) => line.disposition === "mint").length,
    excludedWeak: lines.filter((line) => line.disposition === "weak").length,
    excludedCheck: lines.filter((line) => line.disposition === "check").length,
    stocktakeRows: (payload.stocktake_rows as unknown[]).length,
    feetOnStocktake: roundFeet(stockLines.reduce((sum, line) => sum + line.feet, 0)),
    feetExisting: roundFeet(lines.filter((line) => line.disposition === "upload").reduce((sum, line) => sum + line.feet, 0)),
    feetToMint: roundFeet(lines.filter((line) => line.disposition === "mint").reduce((sum, line) => sum + line.feet, 0)),
    feetExcludedWeak: roundFeet(lines.filter((line) => line.disposition === "weak").reduce((sum, line) => sum + line.feet, 0)),
    feetExcludedCheck: roundFeet(lines.filter((line) => line.disposition === "check").reduce((sum, line) => sum + line.feet, 0)),
    setRemainingItemsAsCounted: false,
    locationId: CC_MANUFACTURING_LOCATION_ID,
    stocktakeNumber: STOCKTAKE_NUMBER,
    blocked: blocked.length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "confirm-planned" : "dry-run",
    summary,
    excluded: lines
      .filter((line) => line.disposition === "weak" || line.disposition === "check")
      .map((line) => ({
        disposition: line.disposition,
        profile: `${line.type} ${line.size} ${line.gauge}`.trim(),
        sku: line.sku,
        pieces: line.pieces,
        feet: line.feet,
        note: line.note,
      })),
    mints: lines
      .filter((line) => line.disposition === "mint")
      .map((line) => ({
        sku: line.sku,
        name: line.name,
        uom: "ft",
        category: "Metal",
        pieces: line.pieces,
        feet: line.feet,
      })),
    blockers: blocked.map((line) => ({ sku: line.sku, reason: line.blocker })),
    stocktake: payload,
    lines: lines.map((line) => ({
      profile: `${line.type} ${line.size} ${line.gauge}`.trim(),
      disposition: line.disposition,
      sku: line.sku,
      name: line.name,
      pieces: line.pieces,
      lengthFt: line.lengthFt,
      feet: line.feet,
      variantId: line.variantId,
      liveOnHand: line.liveOnHand,
      blocker: line.blocker,
    })),
  };

  if (summary.feetOnStocktake !== 10800 || summary.excludedWeak !== 0 || summary.excludedCheck !== 0) {
    throw new Error(
      `Metal count must upload 10800 ft with nothing excluded. Got ${summary.feetOnStocktake} ft, weak=${summary.excludedWeak}, check=${summary.excludedCheck}.`,
    );
  }

  mkdirSync(join(process.cwd(), "data_migration", "reports"), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(JSON.stringify(summary, null, 2));
  if (blocked.length > 0) {
    console.log("Stocktake blockers:");
    for (const line of blocked) console.log(`  ${line.blocker}`);
  }

  if (!confirm) return;
  if (blocked.length > 0) {
    throw new Error(`Refusing --confirm. ${blocked.length} metal row(s) are blocked.`);
  }

  for (const line of lines.filter((row) => row.disposition === "mint")) {
    if (line.variantId != null) {
      console.log(`  ${line.sku} already in Katana variant ${line.variantId}`);
      continue;
    }
    line.variantId = await mintMaterial(line);
    console.log(`  minted ${line.sku} variant ${line.variantId}`);
  }

  const existing = await findStocktake();
  const existingStatus = String(existing?.status ?? "");
  if (existingStatus === "COMPLETED") {
    const pending = stockLines.filter((line) => (line.liveOnHand ?? 0) <= 0.0001);
    if (pending.length === 0) {
      console.log(`  ${STOCKTAKE_NUMBER} already COMPLETED and every counted SKU is on hand.`);
      return;
    }
    const addNumber = `${STOCKTAKE_NUMBER}-ADD`;
    console.log(
      `  ${STOCKTAKE_NUMBER} is already COMPLETED. Posting ${pending.length} new variant(s), ${pending.reduce((sum, line) => sum + line.feet, 0)} ft, on ${addNumber}. set_remaining_items_as_counted=false.`,
    );
    await postStocktake(addNumber, pending);
    return;
  }
  if (existing) {
    throw new Error(
      `${STOCKTAKE_NUMBER} already exists with status ${existingStatus}. Refusing to finish a stocktake that may not include the new variants.`,
    );
  }

  await postStocktake(STOCKTAKE_NUMBER, stockLines);
}

async function postStocktake(
  stocktakeNumber: string,
  countLines: CountLine[],
): Promise<void> {
  const body = {
    stocktake_number: stocktakeNumber,
    location_id: CC_MANUFACTURING_LOCATION_ID,
    reason: "Aluminum extrusion physical count 2026-10-01. Feet = sticks × length. Fabric and finished goods are not in this count.",
    created_date: "2026-10-01",
    set_remaining_items_as_counted: false as const,
    stocktake_rows: countLines.map((line) => ({
      variant_id: line.variantId,
      counted_quantity: line.feet,
      notes: `${line.sku} ${line.pieces} sticks × ${line.lengthFt} ft`.slice(0, 540),
    })),
  };
  if (body.stocktake_rows.some((row) => !Number.isFinite(Number(row.variant_id)))) {
    throw new Error("Stocktake row is missing a variant id.");
  }
  console.log(
    `  POST /stocktakes ${stocktakeNumber} rows=${body.stocktake_rows.length} set_remaining_items_as_counted=false`,
  );
  const { data } = await katanaFetch<Record<string, unknown>>("/stocktakes", {
    method: "POST",
    idempotencyKey: stocktakeNumber,
    body,
  });
  const created = asRecord(data) ?? {};
  const id = Number(created.id ?? asRecord(created.data)?.id);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`${stocktakeNumber} has no Katana id.`);
  await finishStocktake(id);
  console.log(`Stocktake ${stocktakeNumber} completed id=${id}`);
}

main().catch((error: unknown) => {
  if (error instanceof KatanaApiError && error.details != null) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
