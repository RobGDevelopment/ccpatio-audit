/**
 * Backfill Katana Sales Order custom fields from the 2026 standard report.
 *
 * Allowlist is the WIP- orders already created by import-live-factory-data
 * (data_migration/reports/wip-factory-import.json). Sheet rows outside that
 * list are ignored. ORDER COMPLETED rows are ignored, including when they
 * reuse an open order number. This script does not create sales orders.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/migrate-so-fields-from-csv.ts --confirm-fields
 *   npx dotenv -e .env.local -- tsx scripts/ops/migrate-so-fields-from-csv.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/migrate-so-fields-from-csv.ts --confirm
 *   npx dotenv -e .env.local -- tsx scripts/ops/migrate-so-fields-from-csv.ts --confirm --order 1769
 *
 * Dry-run is the default and always prints the WIP-1769 payload. It does not
 * write. --confirm-fields only creates the migration-owned definitions.
 * Type, Delivery Date, Production Deadline, PU/Drop, Delivery Confirmed,
 * and PU/Drop Confirmed already exist in Katana and are never created here.
 * --confirm patches allowlisted orders.
 *
 * Live Katana types, not the sheet labels:
 * - Type is singleSelect and is sent as the Katana option id.
 *   SERVICE-WARRANT maps to SERVICE WARRANTY (id 3).
 * - Delivery Date, Production Deadline, and PU/Drop are date fields.
 *   Sheet dates are sent as YYYY-MM-DD. HOLD and blank cells are omitted.
 *   The sheet column for PU/Drop is "PU / DROP".
 * - Delivery Confirmed and PU/Drop Confirmed are boolean fields.
 *   YES/NO become true/false. NA, N/A, HOLD, and blank cells are omitted.
 *   Sheet columns are "Delivery Conf." and "PU / DROP Confirmed".
 *
 * Sources (the Columns copies are the 2026-10-02 extracts):
 * - data_migration/Columns/Standard Report 2026 CCPatio - NEW.csv
 * - data_migration/Columns/OpenSalesOrders-2026-10-02-07_46.csv
 *   The open-order export is a gate: every allowlisted WIP- number must
 *   appear there before any PATCH. Values come from the standard report.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KatanaApiError,
  createIntervalPacer,
  findKatanaSalesOrderByOrderNo,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { col, parseQty, readCsvRecords } from "./lib/csv";
import { paginateKatana } from "./lib/katana-paginate";

loadEnvConfig(process.cwd());

const SOURCE = "ccpatio-so-field-migration";
const DRY_RUN_LEGACY = "1769";
const STANDARD_PATH = join(
  process.cwd(),
  "data_migration",
  "Columns",
  "Standard Report 2026 CCPatio - NEW.csv",
);
const OPEN_SALES_ORDERS_PATH = join(
  process.cwd(),
  "data_migration",
  "Columns",
  "OpenSalesOrders-2026-10-02-07_46.csv",
);
const LEDGER_PATH = join(
  process.cwd(),
  "data_migration",
  "reports",
  "wip-factory-import.json",
);
const REPORT_DIR = join(process.cwd(), "data_migration", "reports");
const DRY_RUN_PATH = join(
  REPORT_DIR,
  "so-field-migration-dry-run-WIP-1769.json",
);
const CONFIRM_REPORT_PATH = join(
  REPORT_DIR,
  "so-field-migration-confirm.json",
);

type ValueKind = "text" | "number" | "date" | "boolean" | "singleSelect";
type FieldType = "shortText" | "number" | "date" | "boolean" | "singleSelect";

type FieldSpec = {
  label: string;
  field_type: FieldType;
  column: string;
  valueKind: ValueKind;
  description: string;
  /** False for definitions that already exist in Katana and must not be created. */
  create?: boolean;
};

const TARGET_FIELDS: readonly FieldSpec[] = [
  {
    label: "Delivery Address",
    field_type: "shortText",
    column: "Delivery Address",
    valueKind: "text",
    description: "Historical delivery address from the 2026 standard report.",
  },
  {
    label: "Piece Count Cshn",
    field_type: "shortText",
    column: "QTY CUSH",
    valueKind: "text",
    description: "Historical cushion piece count (QTY CUSH).",
  },
  {
    label: "Piece Count Mtl",
    field_type: "shortText",
    column: "QTY METAL",
    valueKind: "text",
    description: "Historical metal piece count (QTY METAL).",
  },
  {
    label: "Piece Count Dktn",
    field_type: "shortText",
    column: "QTY DEKT",
    valueKind: "text",
    description: "Historical dekton piece count (QTY DEKT).",
  },
  {
    label: "Covers",
    field_type: "shortText",
    column: "Covers",
    valueKind: "text",
    description: "Historical covers status from the 2026 standard report.",
  },
  {
    label: "Umbrella",
    field_type: "shortText",
    column: "Umbrella",
    valueKind: "text",
    description: "Historical umbrella status from the 2026 standard report.",
  },
  {
    label: "Tenjam/Others",
    field_type: "shortText",
    column: "Tenjam/Others",
    valueKind: "text",
    description: "Historical Tenjam/Others status from the 2026 standard report.",
  },
  {
    label: "Firepit System",
    field_type: "shortText",
    column: "Firepit System",
    valueKind: "text",
    description: "Historical firepit system status from the 2026 standard report.",
  },
  {
    label: "Proj Hrs Cushion",
    field_type: "number",
    column: "Proj. Hrs Cushion",
    valueKind: "number",
    description: "Historical projected cushion hours.",
  },
  {
    label: "Proj Hrs Metal",
    field_type: "number",
    column: "Proj. Hrs Metal",
    valueKind: "number",
    description: "Historical projected metal hours.",
  },
  {
    label: "Proj Hrs Dekton",
    field_type: "number",
    column: "Proj. Hrs Dekton",
    valueKind: "number",
    description: "Historical projected dekton hours.",
  },
  {
    label: "Type",
    field_type: "singleSelect",
    column: "Type",
    valueKind: "singleSelect",
    description: "Existing Katana order type.",
    create: false,
  },
  {
    label: "Delivery Date",
    field_type: "date",
    column: "Delivery Date",
    valueKind: "date",
    description: "Existing Katana delivery date.",
    create: false,
  },
  {
    label: "Production Deadline",
    field_type: "date",
    column: "Production Deadline",
    valueKind: "date",
    description: "Existing Katana production deadline.",
    create: false,
  },
  {
    label: "PU/Drop",
    field_type: "date",
    column: "PU / DROP",
    valueKind: "date",
    description: "Existing Katana PU/Drop date. Sheet column is PU / DROP.",
    create: false,
  },
  {
    label: "Delivery Confirmed",
    field_type: "boolean",
    column: "Delivery Conf.",
    valueKind: "boolean",
    description: "Existing Katana delivery-confirmed flag. Sheet column is Delivery Conf.",
    create: false,
  },
  {
    label: "PU/Drop Confirmed",
    field_type: "boolean",
    column: "PU / DROP Confirmed",
    valueKind: "boolean",
    description: "Existing Katana PU/Drop-confirmed flag. Sheet column is PU / DROP Confirmed.",
    create: false,
  },
];

type CustomFieldChoice = { id: number; label: string };

type CustomFieldHit = {
  id: string;
  label: string;
  entity_type: string;
  field_type: string;
  choices?: CustomFieldChoice[];
};

type AllowOrder = {
  legacyOrder: string;
  katanaOrderNo: string;
  salesOrderId: number;
};

type FieldLegendEntry = {
  label: string;
  id: string;
  column: string;
  sheetValue: string | null;
  sent: boolean;
  value: string | number | boolean | null;
};

type DryRunPayload = {
  dryRun: true;
  legacyOrder: string;
  orderNo: string;
  customer: string;
  salesOrderId: number;
  ledgerSalesOrderId: number;
  idMismatch: boolean;
  existingCustomFields: unknown;
  patch: {
    method: "PATCH";
    path: string;
    body: { custom_fields: Record<string, string | number | boolean> };
  };
  fieldLegend: FieldLegendEntry[];
  warnings: string[];
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readCreatedId(data: unknown): string {
  const record = asRecord(data);
  const nested = asRecord(record?.data);
  const id = record?.id ?? nested?.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  throw new Error("POST /custom_field_definitions returned no id.");
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value.trim();
}

function legacyFromFilter(raw: string): string {
  return raw.toUpperCase().startsWith("WIP-") ? raw.slice(4) : raw;
}

function parseProjectedHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(":")) return parseQty(trimmed);

  const parts = trimmed.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const hours = numbers[0] ?? 0;
  const minutes = numbers[1] ?? 0;
  const seconds = numbers[2] ?? 0;
  if (minutes >= 60 || seconds >= 60) return null;
  const decimal = hours + minutes / 60 + seconds / 3600;
  return Math.round(decimal * 10000) / 10000;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * YES/NO from the sheet. NA, N/A, and HOLD are not booleans (caller omits them).
 * Returns null for those sentinels and undefined when the cell is not a flag.
 */
function parseSheetBoolean(raw: string): boolean | null | undefined {
  const value = raw.trim().toUpperCase();
  if (!value || value === "NA" || value === "N/A" || value === "HOLD") return null;
  if (value === "YES" || value === "Y" || value === "TRUE") return true;
  if (value === "NO" || value === "N" || value === "FALSE") return false;
  return undefined;
}

/** Calendar date from the sheet, as YYYY-MM-DD. HOLD and blank are not dates. */
function parseSheetCalendarDate(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.toUpperCase() === "HOLD") return null;

  const named = value.match(/^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
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
    if (year < 100) year += 2000;
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function matchChoice(raw: string, choices: readonly CustomFieldChoice[]): number | null {
  const compact = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const aliases: Record<string, string> = {
    "service warrant": "service warranty",
    "service warranty": "service warranty",
    warranty: "service warranty",
  };
  const wanted = aliases[compact(raw)] ?? compact(raw);
  const hit = choices.find((choice) => compact(choice.label) === wanted);
  return hit?.id ?? null;
}

function loadOpenSalesOrderNumbers(): Set<string> {
  const numbers = new Set<string>();
  for (const row of readCsvRecords(OPEN_SALES_ORDERS_PATH)) {
    const orderNo = col(row, "SO #");
    if (orderNo) numbers.add(orderNo);
  }
  if (numbers.size === 0) {
    throw new Error(`${OPEN_SALES_ORDERS_PATH} has no SO # values.`);
  }
  return numbers;
}

function assertAllowlistIsOpen(
  allowlist: readonly AllowOrder[],
  openOrderNumbers: ReadonlySet<string>,
): void {
  const missing = allowlist
    .filter((order) => !openOrderNumbers.has(order.katanaOrderNo))
    .map((order) => order.katanaOrderNo);
  if (missing.length > 0) {
    throw new Error(
      `Allowlisted orders missing from ${OPEN_SALES_ORDERS_PATH}: ${missing.join(", ")}. No PATCH was sent.`,
    );
  }
}

function loadAllowlist(): AllowOrder[] {
  const parsed = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as {
    orders?: unknown;
  };
  if (!Array.isArray(parsed.orders)) {
    throw new Error(`${LEDGER_PATH} is missing an orders array.`);
  }

  const orders: AllowOrder[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.orders) {
    const record = asRecord(raw);
    const legacyOrder = String(record?.legacyOrder ?? "").trim();
    const katanaOrderNo = String(record?.katanaOrderNo ?? "").trim();
    const salesOrderId = Number(record?.salesOrderId);
    if (!legacyOrder || !katanaOrderNo || !Number.isFinite(salesOrderId)) {
      throw new Error("Allowlist row is missing legacyOrder, katanaOrderNo, or salesOrderId.");
    }
    const expected = `WIP-${legacyOrder}`;
    if (katanaOrderNo !== expected) {
      throw new Error(
        `Allowlist order ${legacyOrder} has katanaOrderNo ${katanaOrderNo}, expected ${expected}.`,
      );
    }
    if (seen.has(legacyOrder)) {
      throw new Error(`Allowlist contains duplicate legacy order ${legacyOrder}.`);
    }
    seen.add(legacyOrder);
    orders.push({ legacyOrder, katanaOrderNo, salesOrderId });
  }
  return orders;
}

function indexSheetRows(
  allowlist: readonly AllowOrder[],
): Map<string, Record<string, string>> {
  const wanted = new Set(allowlist.map((order) => order.legacyOrder));
  const counts = new Map<string, number>();
  const rows = new Map<string, Record<string, string>>();

  for (const row of readCsvRecords(STANDARD_PATH)) {
    const legacyOrder = col(row, "Order Number");
    const status = col(row, "Status").toUpperCase();
    if (!legacyOrder || !wanted.has(legacyOrder)) continue;
    if (status !== "NEW" && status !== "READY FOR DELIVERY") continue;
    counts.set(legacyOrder, (counts.get(legacyOrder) ?? 0) + 1);
    rows.set(legacyOrder, row);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([legacyOrder]) => legacyOrder);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate NEW / READY FOR DELIVERY rows for allowlisted orders: ${duplicates.join(", ")}. No order was chosen.`,
    );
  }

  return rows;
}

function mapField(row: Record<string, unknown>): CustomFieldHit | null {
  const id = row.id;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const entityType = typeof row.entity_type === "string" ? row.entity_type : "";
  const fieldType = typeof row.field_type === "string" ? row.field_type : "";
  if ((typeof id !== "string" && typeof id !== "number") || !label) return null;
  const options = asRecord(row.options);
  const rawChoices = options?.choices;
  const choices: CustomFieldChoice[] = [];
  if (Array.isArray(rawChoices)) {
    for (const item of rawChoices) {
      const record = asRecord(item);
      const choiceLabel = typeof record?.label === "string" ? record.label : "";
      const choiceId = Number(record?.id);
      if (!choiceLabel || !Number.isFinite(choiceId)) continue;
      choices.push({ id: choiceId, label: choiceLabel });
    }
  }
  return {
    id: String(id),
    label,
    entity_type: entityType,
    field_type: fieldType,
    ...(choices.length > 0 ? { choices } : {}),
  };
}

async function hydrateChoices(field: CustomFieldHit): Promise<CustomFieldHit> {
  if (field.choices && field.choices.length > 0) return field;
  const { data } = await katanaFetch(`/custom_field_definitions/${field.id}`);
  const mapped = mapField(asRecord(data) ?? {});
  if (!mapped?.choices?.length) {
    throw new Error(`SalesOrder field "${field.label}" has no singleSelect choices.`);
  }
  return { ...field, choices: mapped.choices };
}

function readExistingCustomFields(
  raw: unknown,
): Record<string, string | number | boolean> {
  if (raw == null) return {};
  const record = asRecord(raw);
  if (!record) {
    throw new Error("Sales order custom_fields is not an object.");
  }
  const existing: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      existing[key] = value;
      continue;
    }
    if (value == null) continue;
    throw new Error(`Sales order custom field ${key} has an unsupported value.`);
  }
  return existing;
}

function mergeCustomFields(
  existing: unknown,
  updates: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return { ...readExistingCustomFields(existing), ...updates };
}

async function listSalesOrderFields(): Promise<CustomFieldHit[]> {
  const rows = await paginateKatana(
    "/custom_field_definitions",
    "custom_field_definitions",
    { quiet: true },
  );
  const fields: CustomFieldHit[] = [];
  for (const row of rows) {
    const field = mapField(row);
    if (field && norm(field.entity_type) === norm("SalesOrder")) {
      fields.push(field);
    }
  }
  return fields;
}

function findField(
  fields: readonly CustomFieldHit[],
  spec: FieldSpec,
): CustomFieldHit | undefined {
  return fields.find(
    (field) =>
      norm(field.label) === norm(spec.label) &&
      norm(field.entity_type) === norm("SalesOrder"),
  );
}

async function ensureFields(fields: CustomFieldHit[]): Promise<void> {
  let created = 0;
  let existing = 0;

  for (const spec of TARGET_FIELDS) {
    const hit = findField(fields, spec);
    if (hit) {
      if (norm(hit.field_type) !== norm(spec.field_type)) {
        throw new Error(
          `SalesOrder field "${spec.label}" already exists as ${hit.field_type} (id=${hit.id}), expected ${spec.field_type}.`,
        );
      }
      existing += 1;
      console.log(`  [EXISTS] ${spec.label} id=${hit.id} field_type=${hit.field_type}`);
      continue;
    }

    if (spec.create === false) {
      throw new Error(
        `SalesOrder field "${spec.label}" (${spec.field_type}) is not defined in Katana. This script will not create it.`,
      );
    }

    const { data } = await katanaFetch("/custom_field_definitions", {
      method: "POST",
      body: {
        label: spec.label,
        field_type: spec.field_type,
        entity_type: "SalesOrder",
        source: SOURCE,
        description: spec.description,
      },
    });
    const id = readCreatedId(data);
    fields.push({
      id,
      label: spec.label,
      entity_type: "SalesOrder",
      field_type: spec.field_type,
    });
    created += 1;
    console.log(`  [CREATED] ${spec.label} id=${id} field_type=${spec.field_type}`);
  }

  console.log("");
  console.log(`Custom fields ready. existing=${existing} created=${created}`);
}

async function requireFields(
  fields: readonly CustomFieldHit[],
): Promise<Map<string, CustomFieldHit>> {
  const byLabel = new Map<string, CustomFieldHit>();
  const missing: string[] = [];
  for (const spec of TARGET_FIELDS) {
    let hit = findField(fields, spec);
    if (!hit) {
      missing.push(spec.label);
      continue;
    }
    if (norm(hit.field_type) !== norm(spec.field_type)) {
      throw new Error(
        `SalesOrder field "${spec.label}" is ${hit.field_type} (id=${hit.id}), expected ${spec.field_type}.`,
      );
    }
    if (spec.valueKind === "singleSelect") {
      hit = await hydrateChoices(hit);
    }
    byLabel.set(spec.label, hit);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing SalesOrder custom fields: ${missing.join(", ")}.`,
    );
  }
  return byLabel;
}

function buildFieldPayload(
  row: Record<string, string>,
  fields: Map<string, CustomFieldHit>,
): {
  customFields: Record<string, string | number | boolean>;
  legend: FieldLegendEntry[];
  warnings: string[];
} {
  const customFields: Record<string, string | number | boolean> = {};
  const legend: FieldLegendEntry[] = [];
  const warnings: string[] = [];

  for (const spec of TARGET_FIELDS) {
    const field = fields.get(spec.label);
    if (!field) {
      throw new Error(`Missing field id for ${spec.label}.`);
    }
    const raw = col(row, spec.column);
    if (!raw) {
      legend.push({
        label: spec.label,
        id: field.id,
        column: spec.column,
        sheetValue: null,
        sent: false,
        value: null,
      });
      continue;
    }

    let value: string | number | boolean;
    if (spec.valueKind === "number") {
      const parsed = parseProjectedHours(raw);
      if (parsed == null) {
        throw new Error(
          `Order ${col(row, "Order Number") || "?"} column "${spec.column}" is not a number or duration: ${raw}`,
        );
      }
      value = parsed;
    } else if (spec.valueKind === "date") {
      if (raw.toUpperCase() === "HOLD") {
        legend.push({
          label: spec.label,
          id: field.id,
          column: spec.column,
          sheetValue: raw,
          sent: false,
          value: null,
        });
        continue;
      }
      const parsed = parseSheetCalendarDate(raw);
      if (!parsed) {
        throw new Error(
          `Order ${col(row, "Order Number") || "?"} column "${spec.column}" is not a date: ${raw}`,
        );
      }
      value = parsed;
    } else if (spec.valueKind === "boolean") {
      const parsed = parseSheetBoolean(raw);
      if (parsed === undefined) {
        throw new Error(
          `Order ${col(row, "Order Number") || "?"} column "${spec.column}" is not YES or NO: ${raw}`,
        );
      }
      if (parsed === null) {
        legend.push({
          label: spec.label,
          id: field.id,
          column: spec.column,
          sheetValue: raw,
          sent: false,
          value: null,
        });
        continue;
      }
      value = parsed;
    } else if (spec.valueKind === "singleSelect") {
      const matched = matchChoice(raw, field.choices ?? []);
      if (!matched) {
        warnings.push(`${spec.label} "${raw}" is not a Katana ${spec.label} choice`);
        legend.push({
          label: spec.label,
          id: field.id,
          column: spec.column,
          sheetValue: raw,
          sent: false,
          value: null,
        });
        continue;
      }
      value = matched;
    } else {
      value = raw;
    }

    customFields[field.id] = value;
    legend.push({
      label: spec.label,
      id: field.id,
      column: spec.column,
      sheetValue: raw,
      sent: true,
      value,
    });
  }

  return { customFields, legend, warnings };
}

async function buildDryRun(
  allowlist: readonly AllowOrder[],
  sheet: Map<string, Record<string, string>>,
  fields: Map<string, CustomFieldHit>,
): Promise<DryRunPayload> {
  const allowed = allowlist.find((order) => order.legacyOrder === DRY_RUN_LEGACY);
  if (!allowed) {
    throw new Error(`WIP-${DRY_RUN_LEGACY} is not in the allowlist.`);
  }
  const row = sheet.get(DRY_RUN_LEGACY);
  if (!row) {
    throw new Error(
      `Order ${DRY_RUN_LEGACY} is in the allowlist but has no row in ${STANDARD_PATH}.`,
    );
  }

  const live = await findKatanaSalesOrderByOrderNo(allowed.katanaOrderNo);
  if (!live) {
    throw new Error(`Katana has no sales order ${allowed.katanaOrderNo}.`);
  }
  const salesOrderId = Number(live.id);
  if (!Number.isFinite(salesOrderId)) {
    throw new Error(`${allowed.katanaOrderNo} returned no numeric id.`);
  }

  const { customFields, legend, warnings } = buildFieldPayload(row, fields);
  return {
    dryRun: true,
    legacyOrder: allowed.legacyOrder,
    orderNo: allowed.katanaOrderNo,
    customer: col(row, "Customer Info"),
    salesOrderId,
    ledgerSalesOrderId: allowed.salesOrderId,
    idMismatch: salesOrderId !== allowed.salesOrderId,
    existingCustomFields: live.custom_fields ?? null,
    patch: {
      method: "PATCH",
      path: `/sales_orders/${salesOrderId}`,
      body: { custom_fields: mergeCustomFields(live.custom_fields, customFields) },
    },
    fieldLegend: legend,
    warnings,
  };
}

function mergeConfirmResults(
  orderFilter: readonly string[] | undefined,
  results: Array<Record<string, unknown>>,
): Record<string, unknown> {
  let combined = results;
  if (orderFilter && orderFilter.length > 0) {
    try {
      const prior = JSON.parse(readFileSync(CONFIRM_REPORT_PATH, "utf8")) as {
        results?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(prior.results)) {
        const byOrder = new Map<string, Record<string, unknown>>();
        for (const row of prior.results) {
          const orderNo = String(row.orderNo ?? "");
          if (orderNo) byOrder.set(orderNo, row);
        }
        for (const row of results) {
          const orderNo = String(row.orderNo ?? "");
          if (orderNo) byOrder.set(orderNo, row);
        }
        combined = [...byOrder.values()];
      }
    } catch {
      combined = results;
    }
  }

  const count = (status: string) =>
    combined.filter((row) => row.status === status).length;

  return {
    updatedAt: new Date().toISOString(),
    orderFilter: orderFilter ?? null,
    patched: count("patched"),
    skippedNotInKatana: count("skipped_not_in_katana"),
    skippedNoCsv: count("skipped_no_csv_row"),
    skippedEmpty: count("skipped_empty"),
    failed: count("failed"),
    results: combined,
  };
}

async function confirmOrders(
  allowlist: readonly AllowOrder[],
  sheet: Map<string, Record<string, string>>,
  fields: Map<string, CustomFieldHit>,
  orderFilter: readonly string[] | undefined,
): Promise<void> {
  const selected = orderFilter
    ? allowlist.filter((order) => orderFilter.includes(order.legacyOrder))
    : allowlist;
  if (orderFilter) {
    const missing = orderFilter.filter(
      (legacyOrder) => !allowlist.some((order) => order.legacyOrder === legacyOrder),
    );
    if (missing.length > 0) {
      throw new Error(`Not in the allowlist: ${missing.join(", ")}.`);
    }
  }

  const results: Array<Record<string, unknown>> = [];
  let patched = 0;
  let skippedNotInKatana = 0;
  let skippedNoCsv = 0;
  let skippedEmpty = 0;
  let failed = 0;

  for (const order of selected) {
    const row = sheet.get(order.legacyOrder);
    if (!row) {
      skippedNoCsv += 1;
      results.push({
        legacyOrder: order.legacyOrder,
        orderNo: order.katanaOrderNo,
        status: "skipped_no_csv_row",
      });
      continue;
    }

    try {
      const live = await findKatanaSalesOrderByOrderNo(order.katanaOrderNo);
      if (!live) {
        skippedNotInKatana += 1;
        results.push({
          legacyOrder: order.legacyOrder,
          orderNo: order.katanaOrderNo,
          status: "skipped_not_in_katana",
        });
        continue;
      }
      const salesOrderId = Number(live.id);
      if (!Number.isFinite(salesOrderId)) {
        throw new Error(`${order.katanaOrderNo} returned no numeric id.`);
      }

      const { customFields: updates, warnings } = buildFieldPayload(row, fields);
      if (Object.keys(updates).length === 0) {
        skippedEmpty += 1;
        results.push({
          legacyOrder: order.legacyOrder,
          orderNo: order.katanaOrderNo,
          salesOrderId,
          status: "skipped_empty",
          warnings,
        });
        continue;
      }

      const customFields = mergeCustomFields(live.custom_fields, updates);
      await katanaFetch(`/sales_orders/${salesOrderId}`, {
        method: "PATCH",
        body: { custom_fields: customFields },
      });
      patched += 1;
      const warningText = warnings.length > 0 ? ` warnings=${warnings.join("; ")}` : "";
      console.log(
        `  [PATCHED] ${order.katanaOrderNo} id=${salesOrderId} fields=${Object.keys(updates).length}${warningText}`,
      );
      results.push({
        legacyOrder: order.legacyOrder,
        orderNo: order.katanaOrderNo,
        salesOrderId,
        ledgerSalesOrderId: order.salesOrderId,
        status: "patched",
        fieldCount: Object.keys(updates).length,
        warnings,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [FAILED] ${order.katanaOrderNo} — ${message}`);
      results.push({
        legacyOrder: order.legacyOrder,
        orderNo: order.katanaOrderNo,
        status: "failed",
        error: message,
      });
    }
  }

  const merged = mergeConfirmResults(orderFilter, results);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(CONFIRM_REPORT_PATH, JSON.stringify(merged, null, 2));

  console.log("");
  console.log("Sales order custom field update");
  console.log(`  patched_this_run: ${patched}`);
  console.log(`  skipped_not_in_katana: ${skippedNotInKatana}`);
  console.log(`  skipped_no_csv_row: ${skippedNoCsv}`);
  console.log(`  skipped_empty: ${skippedEmpty}`);
  console.log(`  failed_this_run: ${failed}`);
  console.log(`  report_patched: ${merged.patched}`);
  console.log(`  report_failed: ${merged.failed}`);
  console.log(`  report: ${CONFIRM_REPORT_PATH}`);

  if (failed > 0) {
    throw new Error(`${failed} sales order update(s) failed.`);
  }
}

async function main(): Promise<void> {
  const confirmFields = process.argv.includes("--confirm-fields");
  const confirm = process.argv.includes("--confirm");
  const dryRunFlag = process.argv.includes("--dry-run");
  const orderArg = flagValue("--order");
  const orderFilter = orderArg
    ? orderArg.split(",").map((part) => legacyFromFilter(part.trim())).filter(Boolean)
    : undefined;

  const modes = [confirmFields, confirm, dryRunFlag].filter(Boolean).length;
  if (modes > 1) {
    throw new Error("Pass only one of --confirm-fields, --dry-run, or --confirm.");
  }
  if (
    dryRunFlag &&
    orderFilter &&
    (orderFilter.length !== 1 || orderFilter[0] !== DRY_RUN_LEGACY)
  ) {
    throw new Error(`Dry-run target is fixed at WIP-${DRY_RUN_LEGACY}.`);
  }

  setKatanaRequestPacer(createIntervalPacer(1100));

  if (confirmFields) {
    console.log("Create missing SalesOrder custom fields");
    const fields = await listSalesOrderFields();
    console.log(`  existing SalesOrder definitions: ${fields.length}`);
    await ensureFields(fields);
    return;
  }

  const dryRun = !confirm;
  const allowlist = loadAllowlist();
  const openOrderNumbers = loadOpenSalesOrderNumbers();
  assertAllowlistIsOpen(allowlist, openOrderNumbers);
  console.log(`Allowlist: ${allowlist.length} WIP- sales orders`);
  console.log(
    `Open sales order export: ${openOrderNumbers.size} order numbers, allowlist covered`,
  );
  const sheet = indexSheetRows(allowlist);
  console.log(`Sheet rows matched to allowlist: ${sheet.size}`);
  console.log(`Source: ${STANDARD_PATH}`);

  const fields = await requireFields(await listSalesOrderFields());

  if (dryRun) {
    console.log(`Dry-run WIP-${DRY_RUN_LEGACY}. No PATCH will be sent.`);
    const payload = await buildDryRun(allowlist, sheet, fields);
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(DRY_RUN_PATH, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${DRY_RUN_PATH}`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    orderFilter
      ? `Live update for ${orderFilter.map((legacyOrder) => `WIP-${legacyOrder}`).join(", ")}`
      : `Live update for ${allowlist.length} allowlisted sales orders`,
  );
  await confirmOrders(allowlist, sheet, fields, orderFilter);
}

main().catch((error: unknown) => {
  if (error instanceof KatanaApiError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
