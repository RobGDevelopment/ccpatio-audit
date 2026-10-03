import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getLogisticsSettings } from "@/server/actions/logistics";
import { getDb } from "@/server/db/client";
import {
  delivery_days,
  delivery_zones,
  inventory_holds,
  logistics_profiles,
  quote_line_items,
  quote_overrides,
  quotes,
} from "@/server/db/schema";
import { phoenixToday } from "@/server/quotes/phoenix-date";
import {
  addCalendarDays,
  isIsoDate,
  PROMISE_FORMULA,
  selectPromiseDay,
  transitDaysForMethod,
  type CapacityDay,
} from "@/server/quotes/promise-formula";

export type CalculatedPromise = {
  ok: true;
  version: number;
  executedBy: string;
  promiseDate: string | null;
  calculatedPromiseDate: string | null;
  promiseTruckCode: string | null;
  promiseError: string | null;
};

export type CalculatePromiseResult =
  | CalculatedPromise
  | { ok: false; error: string };

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value).slice(0, 10);
  return isIsoDate(text) ? text : null;
}

async function shownPromiseDate(
  quote: typeof quotes.$inferSelect,
  calculated: string | null,
): Promise<string | null> {
  if (!quote.promise_override_id) return calculated;
  const db = getDb();
  const [override] = await db
    .select({
      field: quote_overrides.field,
      overrideValue: quote_overrides.override_value,
    })
    .from(quote_overrides)
    .where(eq(quote_overrides.id, quote.promise_override_id))
    .limit(1);
  const value = override?.overrideValue?.slice(0, 10) ?? "";
  if (override?.field === "promise_date" && isIsoDate(value)) return value;
  return calculated;
}

async function writePromise(
  quoteId: string,
  patch: {
    executedBy: string;
    calculated: string | null;
    shown: string | null;
    truckCode: string | null;
    error: string | null;
    now: Date;
  },
): Promise<CalculatePromiseResult> {
  const db = getDb();
  const [updated] = await db
    .update(quotes)
    .set({
      executed_by: patch.executedBy,
      calculated_promise_date: patch.calculated,
      promise_date: patch.shown,
      promise_truck_code: patch.truckCode,
      promise_formula: patch.calculated ? PROMISE_FORMULA : null,
      promise_calculated_at: patch.now,
      promise_error: patch.error,
      version: sql`${quotes.version} + 1`,
      updated_at: patch.now,
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.status, "draft")))
    .returning({ version: quotes.version });
  if (!updated) return { ok: false, error: "This quote is no longer a draft." };
  return {
    ok: true,
    version: updated.version,
    executedBy: patch.executedBy,
    promiseDate: patch.shown,
    calculatedPromiseDate: patch.calculated,
    promiseTruckCode: patch.truckCode,
    promiseError: patch.error,
  };
}

/**
 * Estimate a delivery date for a draft. Reads zone capacity and does not book it.
 * Stock lines are ready on `executed_by` when the hold is active. Configured lines
 * add `logistics_profiles.lead_time_days`. Weight comes from that same profile.
 * Transit comes from the freight snapshot or fleet settings.
 */
export async function calculatePromiseById(
  quoteId: string,
  input: { executedBy?: string | null; now?: Date } = {},
): Promise<CalculatePromiseResult> {
  const now = input.now ?? new Date();
  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "A delivery date is estimated on drafts only." };
  }

  const requested = input.executedBy === undefined ? null : input.executedBy?.trim() ?? "";
  const stored = iso(quote.executed_by) ?? phoenixToday(now);
  const executedBy = requested == null || requested === "" ? stored : requested;
  if (!isIsoDate(executedBy)) {
    return { ok: false, error: "Executed-by must be a real date." };
  }
  if (executedBy < phoenixToday(now)) {
    return { ok: false, error: "The executed-by date cannot be before today." };
  }

  const fail = (error: string) =>
    shownPromiseDate(quote, null).then((shown) =>
      writePromise(quote.id, {
        executedBy,
        calculated: null,
        shown,
        truckCode: null,
        error,
        now,
      }),
    );

  const lines = await db
    .select()
    .from(quote_line_items)
    .where(eq(quote_line_items.quote_id, quote.id));
  if (lines.length === 0) return fail("Add a line before estimating delivery.");

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
  const holdIds = lines
    .map((line) => line.inventory_hold_id)
    .filter((id): id is string => Boolean(id));
  const holds =
    holdIds.length === 0
      ? []
      : await db
          .select({
            id: inventory_holds.id,
            status: inventory_holds.status,
            opportunityId: inventory_holds.ghl_opportunity_id,
          })
          .from(inventory_holds)
          .where(inArray(inventory_holds.id, holdIds));
  const byHold = new Map(holds.map((hold) => [hold.id, hold]));

  let shipmentReady = executedBy;
  let shipmentWeight = 0;
  for (const line of lines) {
    const profile = byVariant.get(line.katana_variant_id);
    const qty = Number(line.qty);
    const weight = Number(profile?.weight_lb);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(weight) || weight <= 0) {
      return fail(`Line ${line.sku} is missing weight.`);
    }
    shipmentWeight += weight * qty;

    if (line.line_kind === "stock_hold") {
      const hold = line.inventory_hold_id ? byHold.get(line.inventory_hold_id) : undefined;
      if (
        !hold ||
        hold.status !== "active" ||
        hold.opportunityId !== quote.ghl_opportunity_id
      ) {
        return fail(`Line ${line.sku} needs an active hold before a delivery date can be estimated.`);
      }
      continue;
    }

    const lead = profile?.lead_time_days;
    if (lead == null || !Number.isInteger(lead) || lead < 0) {
      return fail(`Line ${line.sku} has no lead time.`);
    }
    const ready = addCalendarDays(executedBy, lead);
    if (ready > shipmentReady) shipmentReady = ready;
  }

  const transit = transitDaysForMethod({
    method: quote.freight_method,
    snapshot: quote.freight_snapshot,
    selectedCarrierCode: quote.selected_carrier_code,
    fleetTransitDays: (await getLogisticsSettings()).fleetTransitDays,
  });
  if (!transit.ok) return fail(transit.error);

  const target = addCalendarDays(shipmentReady, transit.days);
  const destZip = quote.dest_zip?.trim() ?? "";
  if (!/^\d{5}$/.test(destZip)) return fail("no_zone");

  const [zone] = await db
    .select({ zoneCode: delivery_zones.zone_code })
    .from(delivery_zones)
    .where(eq(delivery_zones.zip5, destZip))
    .limit(1);
  if (!zone) return fail("no_zone");

  const rows = await db
    .select()
    .from(delivery_days)
    .where(
      and(
        eq(delivery_days.zone_code, zone.zoneCode),
        gte(delivery_days.service_date, target),
      ),
    );
  const days: CapacityDay[] = rows.flatMap((row) => {
    const serviceDate = iso(row.service_date);
    if (!serviceDate) return [];
    return [
      {
        serviceDate,
        truckCode: row.truck_code,
        capacityStops: row.capacity_stops,
        stopsBooked: row.stops_booked,
        capacityWeightLb: Number(row.capacity_weight_lb),
        weightBookedLb: Number(row.weight_booked_lb),
      },
    ];
  });
  const chosen = selectPromiseDay(days, target, shipmentWeight);
  if (!chosen) return fail("no_capacity");

  const shown = await shownPromiseDate(quote, chosen.serviceDate);
  return writePromise(quote.id, {
    executedBy,
    calculated: chosen.serviceDate,
    shown,
    truckCode: chosen.truckCode,
    error: null,
    now,
  });
}
