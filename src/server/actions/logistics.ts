"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  indexLiveKatanaVariants,
  type KatanaVariantRow,
} from "@/lib/hub-katana-sync";
import { KatanaApiError, katanaFetch } from "@/lib/katana";
import {
  normalizeLogisticsProfile,
  type LogisticsProfileInput,
} from "@/lib/logistics-profile";
import { getPimSession } from "@/lib/pim-audit";
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
      .insert(logistics_profiles)
      .values({
        katana_variant_id: normalized.katanaVariantId,
        variant_sku: normalized.variantSku,
        length_in: normalized.lengthIn,
        width_in: normalized.widthIn,
        height_in: normalized.heightIn,
        weight_lb: normalized.weightLb,
        ltl_class: normalized.ltlClass,
        asset_3d_url: normalized.asset3dUrl,
        is_modular_component: normalized.isModularComponent,
      })
      .onConflictDoUpdate({
        target: logistics_profiles.variant_sku,
        set: {
          katana_variant_id: normalized.katanaVariantId,
          length_in: normalized.lengthIn,
          width_in: normalized.widthIn,
          height_in: normalized.heightIn,
          weight_lb: normalized.weightLb,
          ltl_class: normalized.ltlClass,
          asset_3d_url: normalized.asset3dUrl,
          is_modular_component: normalized.isModularComponent,
          updated_at: new Date(),
        },
      })
      .returning();

    if (!row) {
      return { ok: false, error: "Logistics profile did not save" };
    }

    revalidatePath(LOGISTICS_PATH);
    return { ok: true, profile: mapRow(row) };
  } catch (error) {
    const unique = uniqueViolationMessage(error);
    if (unique) return { ok: false, error: unique };
    throw error;
  }
}

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

  const skuSet = new Set(existing.map((row) => row.variantSku));
  const idSet = new Set(existing.map((row) => row.katanaVariantId));
  const conflicts: string[] = [];
  const pending: Array<{
    katana_variant_id: number;
    variant_sku: string;
  }> = [];

  for (const live of indexed.bySku.values()) {
    if (skuSet.has(live.sku)) continue;
    if (idSet.has(live.variantId)) {
      conflicts.push(live.sku);
      continue;
    }
    pending.push({
      katana_variant_id: live.variantId,
      variant_sku: live.sku,
    });
    skuSet.add(live.sku);
    idSet.add(live.variantId);
  }

  let created = 0;
  for (let offset = 0; offset < pending.length; offset += INSERT_CHUNK) {
    const chunk = pending.slice(offset, offset + INSERT_CHUNK);
    const inserted = await db
      .insert(logistics_profiles)
      .values(chunk)
      .onConflictDoNothing({ target: logistics_profiles.variant_sku })
      .returning({ sku: logistics_profiles.variant_sku });
    created += inserted.length;
  }

  revalidatePath(LOGISTICS_PATH);
  return {
    ok: true,
    fetched: indexed.bySku.size,
    created,
    skipped: indexed.bySku.size - created - conflicts.length,
    conflicts,
  };
}

export type LogisticsSettings = {
  id: number;
  localWhiteGloveFee: number;
  localRadiusMiles: number;
  fleetMaxRadiusMiles: number;
  ltlHandlingMarkupPct: number;
  updatedAt: string;
};

export type LogisticsSettingsInput = {
  localWhiteGloveFee: number;
  localRadiusMiles: number;
  fleetMaxRadiusMiles: number;
  ltlHandlingMarkupPct: number;
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
