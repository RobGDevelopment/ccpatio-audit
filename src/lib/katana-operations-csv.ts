/**
 * Katana "Add new product operations" CSV codec.
 *
 * Official Advanced Manufacturing template
 * (`Add-new-operations-advanced-manufacturing.xlsx` → sheet "Product operations"):
 *   Product variant code / SKU (required)
 *   Product variant name              — optional, not imported by Katana
 *   Product operation name (required)
 *   Resource
 *   Type                              — Process | Setup | Per unit | Fixed cost
 *   Cost parameter                    — blank in v1
 *   Hours / Minutes / Seconds
 *
 * Hub `item_operations` rows expand to setup + process like syncBOMToKatana.
 * Resource must be a locked Katana Resource (guard on export).
 */

import { escapeKatanaCsvField, toKatanaCsv } from "@/lib/katana-bom-csv";
import {
  isKatanaResource,
  normalizeKatanaResource,
  resolveKatanaOperationName,
  type TrackStep,
} from "@/lib/factory-routing/resources";

/** Exact header row from Katana's Advanced Manufacturing ops template. */
export const KATANA_OPERATIONS_CSV_HEADERS = [
  "Product variant code / SKU (required)",
  "Product variant name",
  "Product operation name (required)",
  "Resource",
  "Type",
  "Cost parameter",
  "Hours",
  "Minutes",
  "Seconds",
] as const;

export type KatanaOperationCsvRow = {
  productSku: string;
  productName: string;
  operationName: string;
  resource: string;
  /** Katana template uses Title Case: Process | Setup | … */
  operationType: "Setup" | "Process" | "Per unit" | "Fixed cost";
  /** Blank in v1 — shop $/hr rate card deferred. */
  costParameter: string;
  hours: number;
  minutes: number;
  seconds: number;
};

export type HubOperationForExport = {
  itemSku: string;
  productName?: string;
  workCenter: string;
  sequence: number;
  setupTimeMins: number | null;
  runTimeMins: number | null;
};

/** Split decimal minutes into H/M/S (non-negative; rounds to nearest second). */
export function minutesToHms(totalMins: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  if (!Number.isFinite(totalMins) || totalMins <= 0) {
    return { hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSec = Math.round(totalMins * 60);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { hours, minutes, seconds };
}

function parseMins(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Expand one Hub operation into Katana CSV rows (setup then process).
 * Throws if Resource is not in the locked catalog after normalize.
 */
export function hubOperationToKatanaCsvRows(
  op: HubOperationForExport,
): KatanaOperationCsvRow[] {
  const sku = op.itemSku.trim().toUpperCase();
  if (!sku) return [];

  const resource = normalizeKatanaResource(op.workCenter);
  if (!isKatanaResource(resource)) {
    throw new Error(
      `Unknown Katana Resource for ${sku}: "${op.workCenter}" → "${resource}"`,
    );
  }

  const operationName = resolveKatanaOperationName(op.workCenter);
  const productName = (op.productName ?? "").trim();
  const rows: KatanaOperationCsvRow[] = [];

  const setupMins = parseMins(op.setupTimeMins);
  if (setupMins != null) {
    const hms = minutesToHms(setupMins);
    rows.push({
      productSku: sku,
      productName,
      operationName: `${operationName} Setup`,
      resource,
      operationType: "Setup",
      costParameter: "",
      hours: hms.hours,
      minutes: hms.minutes,
      seconds: hms.seconds,
    });
  }

  const runMins = parseMins(op.runTimeMins);
  if (runMins != null) {
    const hms = minutesToHms(runMins);
    rows.push({
      productSku: sku,
      productName,
      operationName,
      resource,
      operationType: "Process",
      costParameter: "",
      hours: hms.hours,
      minutes: hms.minutes,
      seconds: hms.seconds,
    });
  }

  return rows;
}

/** Expand a Standard Track onto a SKU (same shape as Hub ops). */
export function trackStepsToHubOperations(
  itemSku: string,
  steps: readonly TrackStep[],
  productName = "",
): HubOperationForExport[] {
  const sku = itemSku.trim().toUpperCase();
  return steps.map((step) => ({
    itemSku: sku,
    productName,
    workCenter: step.resource,
    sequence: step.sequence,
    setupTimeMins: step.setupTimeMins > 0 ? step.setupTimeMins : null,
    runTimeMins: step.runTimeMins > 0 ? step.runTimeMins : null,
  }));
}

export function expandHubOperationsToKatanaCsvRows(
  ops: readonly HubOperationForExport[],
): KatanaOperationCsvRow[] {
  const sorted = [...ops].sort((a, b) => {
    const skuCmp = a.itemSku.localeCompare(b.itemSku);
    if (skuCmp !== 0) return skuCmp;
    return a.sequence - b.sequence;
  });
  const out: KatanaOperationCsvRow[] = [];
  for (const op of sorted) {
    out.push(...hubOperationToKatanaCsvRows(op));
  }
  return out;
}

export function katanaOperationRowsToCsvMatrix(
  rows: readonly KatanaOperationCsvRow[],
): Array<Array<string | number>> {
  return [
    [...KATANA_OPERATIONS_CSV_HEADERS],
    ...rows.map((row) => [
      row.productSku,
      row.productName,
      row.operationName,
      row.resource,
      row.operationType,
      row.costParameter,
      row.hours,
      row.minutes,
      row.seconds,
    ]),
  ];
}

export function toKatanaOperationsCsv(
  rows: readonly KatanaOperationCsvRow[],
): string {
  return toKatanaCsv(katanaOperationRowsToCsvMatrix(rows));
}

/** Re-export escape for callers that build ad-hoc report CSVs. */
export { escapeKatanaCsvField };
