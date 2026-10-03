"use server";

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  indexLiveKatanaVariants,
  type KatanaVariantRow,
} from "@/lib/hub-katana-sync";
import { planKatanaLogisticsInserts } from "@/lib/logistics-katana-sync";
import { KatanaApiError, katanaFetch } from "@/lib/katana";
import {
  LTL_FREIGHT_CLASSES,
  normalizeLogisticsProfile,
  type LogisticsProfileInput,
} from "@/lib/logistics-profile";
import { getPimSession } from "@/lib/pim-audit";
import { humanNameForSaSku } from "@/lib/sa-display-name";
import { getDb } from "@/server/db/client";
import { logistics_profiles, logistics_settings } from "@/server/db/schema";

export type LogisticsProfileRow = {
  id: string;
  katanaVariantId: number;
  variantSku: string;
  lengthIn: string | null;
  widthIn: string | null;
  heightIn: string | null;
  weightLb: string | null;
  ltlClass: string | null;
  asset3dUrl: string | null;
  isModularComponent: boolean;
  leadTimeDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type LogisticsMutationResult =
  | { ok: true; profile: LogisticsProfileRow }
  | { ok: false; error: string };

export type LogisticsSyncResult =
  | {
      ok: true;
      fetched: number;
      created: number;
      skipped: number;
      conflicts: string[];
    }
  | { ok: false; error: string };

const LOGISTICS_PATH = "/admin/logistics";
const PAGE_SIZE = 250;
const MAX_PAGES = 200;
const INSERT_CHUNK = 100;

function mapRow(
  row: typeof logistics_profiles.$inferSelect,
): LogisticsProfileRow {
  return {
    id: row.id,
    katanaVariantId: row.katana_variant_id,
    variantSku: row.variant_sku,
    lengthIn: row.length_in,
    widthIn: row.width_in,
    heightIn: row.height_in,
    weightLb: row.weight_lb,
    ltlClass: row.ltl_class,
    asset3dUrl: row.asset_3d_url,
    isModularComponent: row.is_modular_component,
    leadTimeDays: row.lead_time_days,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function unwrapList(payload: unknown): KatanaVariantRow[] {
  if (Array.isArray(payload)) return payload as KatanaVariantRow[];
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as KatanaVariantRow[];
  }
  return [];
}

async function requireOperator(): Promise<string | null> {
  const session = await getPimSession();
  return session?.email ?? null;
}

function uniqueViolationMessage(error: unknown): string | null {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) parts.push(current.message);
    if (typeof current !== "object" || current === null) break;
    const record = current as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (record.code) parts.push(record.code);
    if (record.constraint) parts.push(record.constraint);
    if (record.constraint_name) parts.push(record.constraint_name);
    current = record.cause;
  }
  const message = parts.join(" ");
  if (!message.includes("23505") && !/unique/i.test(message)) return null;
  if (message.includes("katana_variant_id")) {
    return "That Katana variant ID is already assigned to another SKU";
  }
  if (message.includes("variant_sku")) {
    return "That variant SKU already has a logistics profile";
  }
  return "A logistics profile with those identifiers already exists";
}

async function listLiveKatanaVariants(): Promise<KatanaVariantRow[]> {
  const all: KatanaVariantRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/variants?include_deleted=false&limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList(data);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Katana returned ${MAX_PAGES} full variant pages. Refusing to sync a partial catalog.`,
  );
}

export async function getLogisticsProfiles(): Promise<LogisticsProfileRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(logistics_profiles)
    .orderBy(asc(logistics_profiles.variant_sku));
  return rows.map(mapRow);
}

/** Catalog row a sales rep can quote without typing weight or NMFC class. */
export type QuotingProduct = {
  variantSku: string;
  /** Readable label. logistics_profiles has no name column, so this is derived from the SKU. */
  name: string;
  /**
   * Sales collection. logistics_profiles has no collection column, so this
   * comes from the SKU prefix (BRV = Bravada, BKN/BRK = Brooklyn, and so on).
   */
  collection: string;
  weightLb: number;
  ltlClass: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number | null;
};

const QUOTEABLE_CLASSES = new Set<string>(LTL_FREIGHT_CLASSES);

/** Whole SKU tokens, longest labels first so BRAVADA wins over BRA. */
const COLLECTION_BY_TOKEN: ReadonlyArray<[string, string]> = [
  ["BRAVADA", "Bravada"],
  ["BROOKLYN", "Brooklyn"],
  ["ACCESSORIES", "Accessories"],
  ["ACCESSORY", "Accessories"],
  ["OCEAN", "Ocean"],
  ["MILAN", "Milan"],
  ["CUSTOM", "Custom"],
  ["BRV", "Bravada"],
  ["BKN", "Brooklyn"],
  ["BRK", "Brooklyn"],
  ["BRA", "Bravada"],
  ["BRO", "Brooklyn"],
  ["OCN", "Ocean"],
  ["OCE", "Ocean"],
  ["MLN", "Milan"],
  ["ACC", "Accessories"],
  ["CUS", "Custom"],
  ["TJM", "Tenjam"],
  ["TAY", "Taylor"],
  ["WFT", "Waterfall"],
  ["DAI", "Daisy"],
  ["FLY", "Fly"],
  ["CAB", "Cabana"],
];

const COLLECTION_LOOKUP = new Map(COLLECTION_BY_TOKEN);

const PREFERRED_COLLECTIONS = ["Bravada", "Brooklyn", "Ocean", "Milan", "Accessories"];

function collectionFromSku(sku: string): string {
  const tokens = sku.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    const label = COLLECTION_LOOKUP.get(token);
    if (label) return label;
  }
  return "Custom";
}

function collectionRank(collection: string): number {
  if (collection === "Custom") return 2_000;
  const preferred = PREFERRED_COLLECTIONS.indexOf(collection);
  if (preferred >= 0) return preferred;
  return 1_000;
}

function quotingName(sku: string): string {
  const body = sku
    .trim()
    .toUpperCase()
    .replace(/^(FIN|SA|ASM)-/, "")
    .replace(/(^|-)BKN(?=-|$)/g, "$1BRK");
  const human = humanNameForSaSku(body).trim();
  return human || sku;
}

function positiveMeasure(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Products the shipping quote form can lock in. A profile needs a weight,
 * a known NMFC class, and packaged length and width on logistics_profiles.
 */
export async function getQuotingProducts(): Promise<QuotingProduct[]> {
  const session = await getPimSession();
  if (!session) {
    throw new Error("Sign in required");
  }

  const db = getDb();
  const rows = await db
    .select({
      variantSku: logistics_profiles.variant_sku,
      weightLb: logistics_profiles.weight_lb,
      ltlClass: logistics_profiles.ltl_class,
      lengthIn: logistics_profiles.length_in,
      widthIn: logistics_profiles.width_in,
      heightIn: logistics_profiles.height_in,
    })
    .from(logistics_profiles)
    .where(
      and(
        isNotNull(logistics_profiles.weight_lb),
        isNotNull(logistics_profiles.ltl_class),
        isNotNull(logistics_profiles.length_in),
        isNotNull(logistics_profiles.width_in),
      ),
    )
    .orderBy(asc(logistics_profiles.variant_sku));

  const products: QuotingProduct[] = [];
  for (const row of rows) {
    const weightLb = positiveMeasure(row.weightLb);
    const lengthIn = positiveMeasure(row.lengthIn);
    const widthIn = positiveMeasure(row.widthIn);
    const ltlClass = row.ltlClass?.trim() ?? "";
    if (
      weightLb == null ||
      lengthIn == null ||
      widthIn == null ||
      !QUOTEABLE_CLASSES.has(ltlClass)
    ) {
      continue;
    }
    products.push({
      variantSku: row.variantSku,
      name: quotingName(row.variantSku),
      collection: collectionFromSku(row.variantSku),
      weightLb,
      ltlClass,
      lengthIn,
      widthIn,
      heightIn: positiveMeasure(row.heightIn),
    });
  }
  products.sort(
    (left, right) =>
      collectionRank(left.collection) - collectionRank(right.collection) ||
      left.collection.localeCompare(right.collection) ||
      left.name.localeCompare(right.name) ||
      left.variantSku.localeCompare(right.variantSku),
  );
  return products;
}

export async function upsertLogisticsProfile(
  data: LogisticsProfileInput,
): Promise<LogisticsMutationResult> {
  const operator = await requireOperator();
  if (!operator) {
    return { ok: false, error: "Sign in required" };
  }

  let normalized;
  try {
    normalized = normalizeLogisticsProfile(data);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid logistics profile",
    };
  }

  const db = getDb();
  try {
    const [row] = await db
      .update(logistics_profiles)
      .set({
        length_in: normalized.lengthIn,
        width_in: normalized.widthIn,
        height_in: normalized.heightIn,
        weight_lb: normalized.weightLb,
        ltl_class: normalized.ltlClass,
        asset_3d_url: normalized.asset3dUrl,
        is_modular_component: normalized.isModularComponent,
        lead_time_days: normalized.leadTimeDays,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(logistics_profiles.variant_sku, normalized.variantSku),
          eq(logistics_profiles.katana_variant_id, normalized.katanaVariantId),
        ),
      )
      .returning();

    if (!row) {
      return {
        ok: false,
        error: "Sync this SKU from Katana before saving logistics data.",
      };
    }

    revalidatePath(LOGISTICS_PATH);
    return { ok: true, profile: mapRow(row) };
  } catch (error) {
    const unique = uniqueViolationMessage(error);
    if (unique) return { ok: false, error: unique };
    throw error;
  }
}

/**
 * Pull live Katana variant identities into empty logistics rows.
 * Existing profiles are left untouched, including dimensions, weight,
 * NMFC class, and lead time.
 */
export async function syncKatanaLogisticsProfiles(): Promise<LogisticsSyncResult> {
  const operator = await requireOperator();
  if (!operator) {
    return { ok: false, error: "Sign in required" };
  }

  let variants: KatanaVariantRow[];
  try {
    variants = await listLiveKatanaVariants();
  } catch (error) {
    if (error instanceof KatanaApiError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  const indexed = indexLiveKatanaVariants(variants);
  if (indexed.bySku.size === 0) {
    return { ok: false, error: "Katana returned 0 live variants. Nothing was created." };
  }

  const db = getDb();
  const existing = await db
    .select({
      variantSku: logistics_profiles.variant_sku,
      katanaVariantId: logistics_profiles.katana_variant_id,
    })
    .from(logistics_profiles);

  const plan = planKatanaLogisticsInserts(
    [...indexed.bySku.values()].map((live) => ({
      sku: live.sku,
      variantId: live.variantId,
    })),
    existing,
  );

  let created = 0;
  for (let offset = 0; offset < plan.pending.length; offset += INSERT_CHUNK) {
    const chunk = plan.pending.slice(offset, offset + INSERT_CHUNK);
    const inserted = await db
      .insert(logistics_profiles)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ sku: logistics_profiles.variant_sku });
    created += inserted.length;
  }

  revalidatePath(LOGISTICS_PATH);
  return {
    ok: true,
    fetched: indexed.bySku.size,
    created,
    skipped: indexed.bySku.size - created - plan.conflicts.length,
    conflicts: plan.conflicts,
  };
}

export type LogisticsSettings = {
  id: number;
  localWhiteGloveFee: number;
  localRadiusMiles: number;
  fleetMaxRadiusMiles: number;
  ltlHandlingMarkupPct: number;
  fleetBaseFee: number | null;
  fleetPerMile: number | null;
  fleetPerPound: number | null;
  fleetTransitDays: number;
  depositPct: number;
  updatedAt: string;
};

export type LogisticsSettingsInput = {
  localWhiteGloveFee: number;
  localRadiusMiles: number;
  fleetMaxRadiusMiles: number;
  ltlHandlingMarkupPct: number;
  fleetBaseFee: number | null;
  fleetPerMile: number | null;
  fleetPerPound: number | null;
  fleetTransitDays: number;
  depositPct: number;
};

export type LogisticsSettingsResult =
  | { ok: true; settings: LogisticsSettings }
  | { ok: false; error: string };

function moneyNumber(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not a number`);
  }
  return value;
}

function optionalMoney(raw: string | null, label: string): number | null {
  if (raw == null) return null;
  return moneyNumber(raw, label);
}

function mapSettings(
  row: typeof logistics_settings.$inferSelect,
): LogisticsSettings {
  return {
    id: row.id,
    localWhiteGloveFee: moneyNumber(
      row.local_white_glove_fee,
      "Local white-glove fee",
    ),
    localRadiusMiles: row.local_radius_miles,
    fleetMaxRadiusMiles: row.fleet_max_radius_miles,
    ltlHandlingMarkupPct: moneyNumber(
      row.ltl_handling_markup_pct,
      "LTL handling markup",
    ),
    fleetBaseFee: optionalMoney(row.fleet_base_fee, "Fleet base fee"),
    fleetPerMile: optionalMoney(row.fleet_per_mile, "Fleet per mile"),
    fleetPerPound: optionalMoney(row.fleet_per_pound, "Fleet per pound"),
    fleetTransitDays: row.fleet_transit_days,
    depositPct: moneyNumber(row.deposit_pct, "Deposit percent"),
    updatedAt: row.updated_at.toISOString(),
  };
}

function parseFee(value: number, label: string, max: number): string {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be between 0 and ${max}`);
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseMiles(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new Error(`${label} must be a whole number of miles from 1 to 5000`);
  }
  return value;
}

function parseNullableFee(
  value: number | null,
  label: string,
  max: number,
  places: number,
): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be between 0 and ${max}, or blank`);
  }
  return value.toFixed(places);
}

function parseTransitDays(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    throw new Error("Fleet transit days must be a whole number from 0 to 60");
  }
  return value;
}

function parseDeposit(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error("Deposit percent must be greater than 0 and at most 100");
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

async function ensureLogisticsSettings(): Promise<LogisticsSettings> {
  const db = getDb();
  await db
    .insert(logistics_settings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: logistics_settings.id });

  const [row] = await db
    .select()
    .from(logistics_settings)
    .where(eq(logistics_settings.id, 1))
    .limit(1);

  if (!row) {
    throw new Error("logistics_settings row was not created");
  }
  return mapSettings(row);
}

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  return ensureLogisticsSettings();
}

export async function updateLogisticsSettings(
  data: LogisticsSettingsInput,
): Promise<LogisticsSettingsResult> {
  const operator = await requireOperator();
  if (!operator) {
    return { ok: false, error: "Sign in required" };
  }

  let fee: string;
  let markup: string;
  let localRadius: number;
  let fleetRadius: number;
  let fleetBase: string | null;
  let fleetMile: string | null;
  let fleetPound: string | null;
  let transitDays: number;
  let deposit: string;
  try {
    fee = parseFee(data.localWhiteGloveFee, "Local white-glove fee", 100_000);
    markup = parseFee(data.ltlHandlingMarkupPct, "LTL handling markup", 100);
    localRadius = parseMiles(data.localRadiusMiles, "Local radius");
    fleetRadius = parseMiles(
      data.fleetMaxRadiusMiles,
      "Internal fleet max radius",
    );
    if (fleetRadius < localRadius) {
      throw new Error(
        "Internal fleet max radius must be at least the local radius",
      );
    }
    fleetBase = parseNullableFee(data.fleetBaseFee, "Fleet base fee", 100_000, 2);
    fleetMile = parseNullableFee(data.fleetPerMile, "Fleet per mile", 100_000, 2);
    fleetPound = parseNullableFee(
      data.fleetPerPound,
      "Fleet per pound",
      100_000,
      4,
    );
    transitDays = parseTransitDays(data.fleetTransitDays);
    deposit = parseDeposit(data.depositPct);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid settings",
    };
  }

  await ensureLogisticsSettings();
  const db = getDb();
  const [row] = await db
    .update(logistics_settings)
    .set({
      local_white_glove_fee: fee,
      local_radius_miles: localRadius,
      fleet_max_radius_miles: fleetRadius,
      ltl_handling_markup_pct: markup,
      fleet_base_fee: fleetBase,
      fleet_per_mile: fleetMile,
      fleet_per_pound: fleetPound,
      fleet_transit_days: transitDays,
      deposit_pct: deposit,
      updated_at: new Date(),
    })
    .where(eq(logistics_settings.id, 1))
    .returning();

  if (!row) {
    throw new Error("logistics_settings update did not return a row");
  }

  revalidatePath(LOGISTICS_PATH);
  return { ok: true, settings: mapSettings(row) };
}
