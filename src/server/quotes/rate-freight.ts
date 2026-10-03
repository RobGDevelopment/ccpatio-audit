import { and, eq, inArray, sql } from "drizzle-orm";
import { getLogisticsSettings } from "@/server/actions/logistics";
import { getDb } from "@/server/db/client";
import {
  freight_rate_cache,
  logistics_profiles,
  quote_line_items,
  quote_overrides,
  quotes,
  type DistanceSource,
  type FreightMethodColumn,
} from "@/server/db/schema";
import { lookupDockDistance } from "@/server/freight/distance";
import { calculateFulfillmentOptions } from "@/server/freight/fulfillment";
import {
  assertPackedHeight,
  buildPalletSkid,
  freightCacheExpiry,
  freightCacheFresh,
  freightInputHash,
  isFulfillmentPlan,
  isKnownFreightClass,
  selectAppliedOption,
  type FreightTariffSettings,
  type RatedLineInput,
} from "@/server/freight/quote-rate";
import { FreightRatingError } from "@/server/freight/priority1";
import { merchandiseTotal } from "@/server/quotes/msrp";
import type {
  FreightSkid,
  FulfillmentMethod,
  FulfillmentPlan,
} from "@/types/freight";

export type FreightOptionQuote = {
  method: FulfillmentMethod;
  priceUsd: number | null;
};

export type RatedQuoteFreight = {
  ok: true;
  version: number;
  destZip: string | null;
  distanceMiles: string | null;
  distanceSource: DistanceSource | null;
  freightMethod: FreightMethodColumn | null;
  freightTotal: string | null;
  calculatedFreightTotal: string | null;
  freightError: string | null;
  merchandiseTotal: string | null;
  freightOptions: FreightOptionQuote[];
};

export type RateQuoteFreightResult =
  | RatedQuoteFreight
  | { ok: false; error: string };

type PlanFn = (
  destZip: string,
  distanceMiles: number,
  skid: FreightSkid,
) => Promise<FulfillmentPlan>;

export type FreightRaterDeps = {
  now?: () => Date;
  measureDistance?: (destZip: string) => Promise<{ miles: number } | null>;
  plan?: PlanFn;
  loadSettings?: () => Promise<FreightTariffSettings>;
};

type QuoteRow = typeof quotes.$inferSelect;
type LineRow = typeof quote_line_items.$inferSelect;

function zip5(raw: string | null | undefined): string | null {
  const zip = raw?.trim() ?? "";
  return /^\d{5}$/.test(zip) ? zip : null;
}

function optionsOf(plan: FulfillmentPlan | null): FreightOptionQuote[] {
  if (!plan) return [];
  return plan.options.map((option) => ({
    method: option.method,
    priceUsd: option.priceUsd,
  }));
}

function carrierCode(option: FulfillmentPlan["options"][number]): string | null {
  if (option.method !== "PRIORITY1_LTL") return null;
  const code = option.carriers?.[0]?.carrierCode?.trim();
  return code || null;
}

function moneyText(value: number): string {
  return value.toFixed(2);
}

async function shownFreightTotal(
  quote: QuoteRow,
  calculated: number,
): Promise<string> {
  if (!quote.freight_override_id) return moneyText(calculated);
  const db = getDb();
  const [override] = await db
    .select({
      field: quote_overrides.field,
      overrideValue: quote_overrides.override_value,
    })
    .from(quote_overrides)
    .where(eq(quote_overrides.id, quote.freight_override_id))
    .limit(1);
  if (override?.field !== "freight_total" || override.overrideValue == null) {
    return moneyText(calculated);
  }
  const amount = Number(override.overrideValue);
  if (!Number.isFinite(amount) || amount < 0) return moneyText(calculated);
  return moneyText(amount);
}

async function writeFreight(
  quote: QuoteRow,
  patch: {
    destZip: string | null;
    distanceMiles: string | null;
    distanceSource: DistanceSource | null;
    freightMethod: FreightMethodColumn | null;
    freightTotal: string | null;
    calculatedFreightTotal: string | null;
    freightSnapshot: FulfillmentPlan | null;
    freightInputHash: string | null;
    freightQuotedAt: Date | null;
    freightError: string | null;
    selectedCarrierCode: string | null;
    merchandiseTotal?: string | null;
    now: Date;
  },
  snapshots: Array<{ lineId: string; profile: typeof logistics_profiles.$inferSelect }>,
): Promise<RatedQuoteFreight | { ok: false; error: string }> {
  const db = getDb();
  let version = quote.version;
  let missing = false;
  await db.transaction(async (tx) => {
    for (const snap of snapshots) {
      await tx
        .update(quote_line_items)
        .set({
          weight_lb: snap.profile.weight_lb,
          ltl_class: snap.profile.ltl_class,
          length_in: snap.profile.length_in,
          width_in: snap.profile.width_in,
          updated_at: patch.now,
        })
        .where(eq(quote_line_items.id, snap.lineId));
    }
    const [updated] = await tx
      .update(quotes)
      .set({
        dest_zip: patch.destZip,
        distance_miles: patch.distanceMiles,
        distance_source: patch.distanceSource,
        freight_method: patch.freightMethod,
        freight_total: patch.freightTotal,
        calculated_freight_total: patch.calculatedFreightTotal,
        freight_snapshot: patch.freightSnapshot,
        freight_input_hash: patch.freightInputHash,
        freight_quoted_at: patch.freightQuotedAt,
        freight_error: patch.freightError,
        selected_carrier_code: patch.selectedCarrierCode,
        ...(patch.merchandiseTotal !== undefined
          ? { merchandise_total: patch.merchandiseTotal }
          : {}),
        version: sql`${quotes.version} + 1`,
        updated_at: patch.now,
      })
      .where(and(eq(quotes.id, quote.id), eq(quotes.status, "draft")))
      .returning({ version: quotes.version });
    if (!updated) {
      missing = true;
      return;
    }
    version = updated.version;
  });
  if (missing) {
    return { ok: false, error: "This quote is no longer a draft." };
  }
  return {
    ok: true,
    version,
    destZip: patch.destZip,
    distanceMiles: patch.distanceMiles,
    distanceSource: patch.distanceSource,
    freightMethod: patch.freightMethod,
    freightTotal: patch.freightTotal,
    calculatedFreightTotal: patch.calculatedFreightTotal,
    freightError: patch.freightError,
    merchandiseTotal:
      patch.merchandiseTotal !== undefined
        ? patch.merchandiseTotal
        : quote.merchandise_total,
    freightOptions: optionsOf(patch.freightSnapshot),
  };
}

async function refuse(
  quote: QuoteRow,
  message: string,
  now: Date,
  distance?: {
    destZip: string | null;
    miles: string | null;
    source: DistanceSource | null;
  },
): Promise<RatedQuoteFreight | { ok: false; error: string }> {
  return writeFreight(
    quote,
    {
      destZip: distance?.destZip ?? quote.dest_zip?.trim() ?? null,
      distanceMiles: distance?.miles ?? null,
      distanceSource: distance?.source ?? null,
      freightMethod: null,
      freightTotal: null,
      calculatedFreightTotal: null,
      freightSnapshot: null,
      freightInputHash: null,
      freightQuotedAt: null,
      freightError: message,
      selectedCarrierCode: null,
      now,
    },
    [],
  );
}

function lineInput(
  line: LineRow,
  profile: typeof logistics_profiles.$inferSelect | undefined,
): { ok: true; input: RatedLineInput } | { ok: false; error: string } {
  const missing = `Line ${line.sku} is missing weight, class, length, or width.`;
  if (!profile) return { ok: false, error: missing };
  const qty = Number(line.qty);
  const weight = Number(profile.weight_lb);
  const length = Number(profile.length_in);
  const width = Number(profile.width_in);
  const freightClass = profile.ltl_class?.trim() ?? "";
  if (
    !Number.isFinite(qty) ||
    qty <= 0 ||
    !Number.isFinite(weight) ||
    weight <= 0 ||
    !isKnownFreightClass(freightClass) ||
    !Number.isFinite(length) ||
    length <= 0 ||
    !Number.isFinite(width) ||
    width <= 0
  ) {
    return { ok: false, error: missing };
  }
  return {
    ok: true,
    input: {
      sku: line.sku.trim().toUpperCase(),
      qty,
      unitWeightLb: weight,
      freightClass,
      lengthIn: length,
      widthIn: width,
    },
  };
}

async function cacheFailure(
  hash: string,
  destZip: string,
  message: string,
  now: Date,
): Promise<void> {
  const db = getDb();
  await db
    .insert(freight_rate_cache)
    .values({
      input_hash: hash,
      dest_zip: destZip,
      plan: null,
      error: message,
      expires_at: freightCacheExpiry("failure", now),
      created_at: now,
    })
    .onConflictDoUpdate({
      target: freight_rate_cache.input_hash,
      set: {
        dest_zip: destZip,
        plan: null,
        error: message,
        expires_at: freightCacheExpiry("failure", now),
        created_at: now,
      },
    });
}

async function cacheSuccess(
  hash: string,
  destZip: string,
  plan: FulfillmentPlan,
  now: Date,
): Promise<void> {
  const db = getDb();
  await db
    .insert(freight_rate_cache)
    .values({
      input_hash: hash,
      dest_zip: destZip,
      plan,
      error: null,
      expires_at: freightCacheExpiry("success", now),
      created_at: now,
    })
    .onConflictDoUpdate({
      target: freight_rate_cache.input_hash,
      set: {
        dest_zip: destZip,
        plan,
        error: null,
        expires_at: freightCacheExpiry("success", now),
        created_at: now,
      },
    });
}

/**
 * Rate a draft quote. Cache hits skip `calculateFulfillmentOptions`.
 * A manager mile override is used as-is and is not written back to `dock_distances`.
 * A freight override keeps `freight_total` and still refreshes `calculated_freight_total`.
 */
export async function rateQuoteById(
  quoteId: string,
  input: { destZip?: string | null } = {},
  deps: FreightRaterDeps = {},
): Promise<RateQuoteFreightResult> {
  const now = deps.now?.() ?? new Date();
  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "Freight is rated on drafts only." };
  }

  const requested =
    input.destZip === undefined ? quote.dest_zip : input.destZip;
  const destZip = zip5(requested);
  if (!destZip) {
    return refuse(quote, "Destination ZIP must be 5 digits.", now, {
      destZip: null,
      miles: null,
      source: null,
    });
  }

  const lines = await db
    .select()
    .from(quote_line_items)
    .where(eq(quote_line_items.quote_id, quote.id));
  if (lines.length === 0) {
    return refuse(quote, "Add a shippable line before rating freight.", now, {
      destZip,
      miles: quote.distance_miles,
      source: quote.distance_source,
    });
  }

  const profiles = await db
    .select()
    .from(logistics_profiles)
    .where(
      inArray(
        logistics_profiles.katana_variant_id,
        lines.map((line) => line.katana_variant_id),
      ),
    );
  const byVariant = new Map(
    profiles.map((profile) => [profile.katana_variant_id, profile]),
  );
  const anyParent = lines.some((line) => {
    const profile = byVariant.get(line.katana_variant_id);
    return profile != null && !profile.is_modular_component;
  });
  const included = lines.filter((line) => {
    const profile = byVariant.get(line.katana_variant_id);
    return !(profile?.is_modular_component && anyParent);
  });
  if (included.length === 0) {
    return refuse(quote, "Add a shippable line before rating freight.", now, {
      destZip,
      miles: quote.distance_miles,
      source: quote.distance_source,
    });
  }

  const rated: RatedLineInput[] = [];
  for (const line of included) {
    const parsed = lineInput(line, byVariant.get(line.katana_variant_id));
    if (!parsed.ok) {
      return refuse(quote, parsed.error, now, {
        destZip,
        miles: quote.distance_miles,
        source: quote.distance_source,
      });
    }
    rated.push(parsed.input);
  }

  let packedHeight: number;
  try {
    packedHeight = assertPackedHeight(Number(quote.packed_height_in));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Packed height is outside 36 to 45 inches.";
    return refuse(quote, message, now, {
      destZip,
      miles: quote.distance_miles,
      source: quote.distance_source,
    });
  }

  let miles: number;
  let distanceSource: DistanceSource;
  if (
    quote.distance_source === "manual_override" &&
    quote.distance_miles != null &&
    Number(quote.distance_miles) >= 0
  ) {
    miles = Number(quote.distance_miles);
    distanceSource = "manual_override";
  } else {
    const measure = deps.measureDistance ?? ((zip: string) => lookupDockDistance(zip));
    let measured: { miles: number } | null;
    try {
      measured = await measure(destZip);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Distance lookup failed.";
      return refuse(quote, message, now, {
        destZip,
        miles: null,
        source: null,
      });
    }
    if (!measured || !Number.isFinite(measured.miles) || measured.miles < 0) {
      return refuse(quote, "No measured miles for this ZIP.", now, {
        destZip,
        miles: null,
        source: null,
      });
    }
    miles = measured.miles;
    distanceSource = "geocode";
  }

  const settings = await (deps.loadSettings ?? getLogisticsSettings)();
  const hash = freightInputHash({
    destinationZip: destZip,
    distanceMiles: miles,
    packedHeightIn: packedHeight,
    lines: rated,
    settings,
  });

  let plan: FulfillmentPlan | null = null;
  let quotedAt = now;
  const [cached] = await db
    .select()
    .from(freight_rate_cache)
    .where(eq(freight_rate_cache.input_hash, hash))
    .limit(1);
  if (cached && freightCacheFresh(cached.expires_at, now)) {
    if (cached.error) {
      return refuse(quote, cached.error, now, {
        destZip,
        miles: miles.toFixed(2),
        source: distanceSource,
      });
    }
    if (isFulfillmentPlan(cached.plan)) {
      plan = cached.plan;
      quotedAt = cached.created_at;
    }
  }

  if (!plan) {
    const planFn = deps.plan ?? calculateFulfillmentOptions;
    try {
      const skid = buildPalletSkid(rated, packedHeight);
      plan = await planFn(destZip, miles, skid);
      quotedAt = now;
      await cacheSuccess(hash, destZip, plan, now);
    } catch (error) {
      const message =
        error instanceof FreightRatingError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Freight rating failed.";
      await cacheFailure(hash, destZip, message, now);
      return refuse(quote, message, now, {
        destZip,
        miles: miles.toFixed(2),
        source: distanceSource,
      });
    }
  }

  let applied;
  try {
    applied = selectAppliedOption(plan, quote.freight_method);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No freight option applies to this shipment.";
    await cacheFailure(hash, destZip, message, now);
    return refuse(quote, message, now, {
      destZip,
      miles: miles.toFixed(2),
      source: distanceSource,
    });
  }
  if (applied.priceUsd == null || !Number.isFinite(applied.priceUsd)) {
    const message = "The selected freight option has no customer total.";
    await cacheFailure(hash, destZip, message, now);
    return refuse(quote, message, now, {
      destZip,
      miles: miles.toFixed(2),
      source: distanceSource,
    });
  }

  const calculated = applied.priceUsd;
  const shown = await shownFreightTotal(quote, calculated);
  const goods = merchandiseTotal(
    included.map((line) => ({ unitPrice: line.unit_price, qty: line.qty })),
  );
  const snapshots = lines.flatMap((line) => {
    const profile = byVariant.get(line.katana_variant_id);
    return profile ? [{ lineId: line.id, profile }] : [];
  });
  return writeFreight(
    quote,
    {
      destZip,
      distanceMiles: miles.toFixed(2),
      distanceSource,
      freightMethod: applied.method,
      freightTotal: shown,
      calculatedFreightTotal: moneyText(calculated),
      freightSnapshot: plan,
      freightInputHash: hash,
      freightQuotedAt: quotedAt,
      freightError: null,
      selectedCarrierCode: carrierCode(applied),
      merchandiseTotal: goods,
      now,
    },
    snapshots,
  );
}

/** Switch the applied option on a fresh snapshot. Does not call the broker again. */
export async function selectQuoteFreightMethodById(
  quoteId: string,
  method: FulfillmentMethod,
  now = new Date(),
): Promise<RateQuoteFreightResult> {
  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "Freight is rated on drafts only." };
  }
  if (!isFulfillmentPlan(quote.freight_snapshot) || !quote.freight_quoted_at) {
    return {
      ok: false,
      error: "Rate this shipment again before switching the freight method.",
    };
  }
  const expires = freightCacheExpiry("success", quote.freight_quoted_at);
  if (!freightCacheFresh(expires, now)) {
    return {
      ok: false,
      error: "Rate this shipment again before switching the freight method.",
    };
  }
  const option = quote.freight_snapshot.options.find((item) => item.method === method);
  if (!option || option.priceUsd == null || !Number.isFinite(option.priceUsd)) {
    return { ok: false, error: "That freight method is not on this rate." };
  }
  const shown = await shownFreightTotal(quote, option.priceUsd);
  return writeFreight(
    quote,
    {
      destZip: quote.dest_zip?.trim() ?? null,
      distanceMiles: quote.distance_miles,
      distanceSource: quote.distance_source,
      freightMethod: method,
      freightTotal: shown,
      calculatedFreightTotal: moneyText(option.priceUsd),
      freightSnapshot: quote.freight_snapshot,
      freightInputHash: quote.freight_input_hash,
      freightQuotedAt: quote.freight_quoted_at,
      freightError: null,
      selectedCarrierCode: carrierCode(option),
      now,
    },
    [],
  );
}
