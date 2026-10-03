import { readFileSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import {
  delivery_days,
  delivery_zones,
  inventory_holds,
  logistics_profiles,
  quote_line_items,
  quote_overrides,
  quotes,
} from "@/server/db/schema";
import { getLogisticsSettings } from "@/server/actions/logistics";
import { overrideQuotePromiseDate } from "@/server/quotes/freight-override";
import { calculatePromiseById } from "@/server/quotes/calculate-promise";
import { phoenixToday } from "@/server/quotes/phoenix-date";
import { commercialOverrideAllowed } from "@/server/quotes/override-role";
import {
  addCalendarDays,
  selectPromiseDay,
} from "@/server/quotes/promise-formula";

describe("promise formula", () => {
  it("adds calendar days and keeps the earlier truck off the target", () => {
    expect(addCalendarDays("2026-10-30", 3)).toBe("2026-11-02");
    const chosen = selectPromiseDay(
      [
        {
          serviceDate: "2026-10-01",
          truckCode: "EARLY",
          capacityStops: 2,
          stopsBooked: 0,
          capacityWeightLb: 500,
          weightBookedLb: 0,
        },
        {
          serviceDate: "2026-10-08",
          truckCode: "FULL",
          capacityStops: 1,
          stopsBooked: 1,
          capacityWeightLb: 500,
          weightBookedLb: 0,
        },
        {
          serviceDate: "2026-10-08",
          truckCode: "LIGHT",
          capacityStops: 2,
          stopsBooked: 0,
          capacityWeightLb: 200,
          weightBookedLb: 150,
        },
        {
          serviceDate: "2026-10-08",
          truckCode: "ROOMY",
          capacityStops: 2,
          stopsBooked: 0,
          capacityWeightLb: 500,
          weightBookedLb: 100,
        },
      ],
      "2026-10-08",
      70,
    );
    expect(chosen?.truckCode).toBe("ROOMY");
    expect(chosen?.serviceDate).toBe("2026-10-08");
  });

  it("does not read a factory deadline", () => {
    const source = readFileSync("src/server/quotes/calculate-promise.ts", "utf8");
    expect(source).not.toContain("production_deadline");
    expect(source).not.toContain("katanaFetch");
    expect(source).not.toContain("@/lib/katana");
    expect(
      commercialOverrideAllowed({
        email: "ghl-embed@ccpatio.com",
        role: "Ops_Manager",
      }),
    ).toBe(false);
  });
});

describe("order desk promise date", () => {
  const quoteIds: string[] = [];
  const zips: string[] = [];
  const variants: number[] = [];
  const holdIds: string[] = [];
  const zones: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const zone of zones) {
      await db.delete(delivery_days).where(eq(delivery_days.zone_code, zone));
    }
    for (const zip of zips) {
      await db.delete(delivery_zones).where(eq(delivery_zones.zip5, zip));
    }
    for (const quoteId of quoteIds) {
      await db
        .update(quotes)
        .set({ promise_override_id: null, freight_override_id: null })
        .where(eq(quotes.id, quoteId));
      await db.delete(quote_overrides).where(eq(quote_overrides.quote_id, quoteId));
      await db.delete(quotes).where(eq(quotes.id, quoteId));
    }
    for (const holdId of holdIds) {
      await db.delete(inventory_holds).where(eq(inventory_holds.id, holdId));
    }
    for (const variantId of variants) {
      await db
        .delete(logistics_profiles)
        .where(eq(logistics_profiles.katana_variant_id, variantId));
    }
    quoteIds.length = 0;
    zips.length = 0;
    variants.length = 0;
    holdIds.length = 0;
    zones.length = 0;
    await closeDb();
  });

  async function seed(input?: {
    leadTimeDays?: number | null;
    holdStatus?: "active" | "released";
    method?: "INTERNAL_FLEET" | "PRIORITY1_LTL";
    transitDays?: number;
    withZone?: boolean;
    withCapacity?: boolean;
  }) {
    const db = getDb();
    const zip = String(randomInt(10000, 99999));
    const zone = `QA-${zip}`;
    const opportunityId = `qa-promise-${randomUUID()}`;
    const executedBy = addCalendarDays(phoenixToday(), 3);
    const stockVariant = randomInt(1, 2_000_000_000);
    const buildVariant = randomInt(1, 2_000_000_000);
    const stockSku = `QA-STK-${randomUUID().slice(0, 8).toUpperCase()}`;
    const buildSku = `QA-CFG-${randomUUID().slice(0, 8).toUpperCase()}`;
    const holdId = randomUUID();
    zips.push(zip);
    zones.push(zone);
    variants.push(stockVariant, buildVariant);
    holdIds.push(holdId);

    await db.insert(logistics_profiles).values([
      {
        katana_variant_id: stockVariant,
        variant_sku: stockSku,
        weight_lb: "40.0000",
        length_in: "70.0000",
        width_in: "30.0000",
        ltl_class: "175",
      },
      {
        katana_variant_id: buildVariant,
        variant_sku: buildSku,
        weight_lb: "30.0000",
        length_in: "60.0000",
        width_in: "28.0000",
        ltl_class: "150",
        lead_time_days: input?.leadTimeDays === undefined ? 3 : input.leadTimeDays,
      },
    ]);
    await db.insert(inventory_holds).values({
      id: holdId,
      katana_variant_id: stockVariant,
      sku: stockSku,
      qty: "1.0000",
      ghl_user_id: "qa-user",
      ghl_user_name: "QA User",
      ghl_contact_id: "qa-contact",
      ghl_opportunity_id: opportunityId,
      ghl_opportunity_name: "QA Promise",
      note: "QA hold",
      status: input?.holdStatus ?? "active",
      release_reason: input?.holdStatus === "released" ? "manual" : null,
      katana_dummy_so_id: randomInt(1, 2_000_000_000),
      order_no: `HOLD-QA-${holdId.slice(0, 8)}`,
    });

    const method = input?.method ?? "INTERNAL_FLEET";
    const transitDays = input?.transitDays ?? 1;
    const [quote] = await db
      .insert(quotes)
      .values({
        ghl_opportunity_id: opportunityId,
        ghl_contact_id: "qa-contact",
        ghl_opportunity_name: "QA Promise",
        ghl_user_id: "qa-user",
        ghl_user_name: "QA User",
        status: "draft",
        dest_zip: zip,
        executed_by: executedBy,
        freight_method: method,
        selected_carrier_code: method === "PRIORITY1_LTL" ? "XPO" : null,
        freight_snapshot:
          method === "PRIORITY1_LTL"
            ? {
                originZip: "85260",
                destinationZip: zip,
                distanceMiles: 200,
                options: [
                  {
                    method: "PRIORITY1_LTL",
                    priceUsd: 250,
                    currency: "USD",
                    summary: "ltl",
                    carriers: [
                      {
                        id: 1,
                        carrierName: "Example",
                        carrierCode: "XPO",
                        transitDays,
                        serviceLevel: "STD",
                        brokerTotalUsd: 200,
                        customerTotalUsd: 250,
                      },
                    ],
                  },
                ],
              }
            : null,
      })
      .returning({ id: quotes.id, version: quotes.version });
    if (!quote) throw new Error("quote was not inserted");
    quoteIds.push(quote.id);
    await db.insert(quote_line_items).values([
      {
        quote_id: quote.id,
        line_no: 1,
        line_kind: "stock_hold",
        sku: stockSku,
        katana_variant_id: stockVariant,
        qty: "1.0000",
        unit_price: "100.00",
        description: "Stock chair",
        inventory_hold_id: holdId,
      },
      {
        quote_id: quote.id,
        line_no: 2,
        line_kind: "configured",
        sku: buildSku,
        katana_variant_id: buildVariant,
        qty: "1.0000",
        unit_price: "200.00",
        description: "Configured chair",
      },
    ]);

    if (input?.withZone !== false) {
      await db.insert(delivery_zones).values({ zip5: zip, zone_code: zone });
    }
    const ready = addCalendarDays(executedBy, input?.leadTimeDays === undefined ? 3 : input.leadTimeDays ?? 0);
    const fleet = (await getLogisticsSettings()).fleetTransitDays;
    const transit = method === "PRIORITY1_LTL" ? transitDays : fleet;
    const target = addCalendarDays(ready, transit);
    if (input?.withCapacity !== false && input?.withZone !== false) {
      await db.insert(delivery_days).values([
        {
          service_date: addCalendarDays(target, -1),
          truck_code: "EARLY",
          zone_code: zone,
          capacity_stops: 2,
          capacity_weight_lb: "500.00",
          stops_booked: 0,
          weight_booked_lb: "0.00",
        },
        {
          service_date: target,
          truck_code: "FULL",
          zone_code: zone,
          capacity_stops: 1,
          capacity_weight_lb: "500.00",
          stops_booked: 1,
          weight_booked_lb: "0.00",
        },
        {
          service_date: target,
          truck_code: "LIGHT",
          zone_code: zone,
          capacity_stops: 2,
          capacity_weight_lb: "100.00",
          stops_booked: 0,
          weight_booked_lb: "80.00",
        },
        {
          service_date: target,
          truck_code: "ROOMY",
          zone_code: zone,
          capacity_stops: 3,
          capacity_weight_lb: "800.00",
          stops_booked: 1,
          weight_booked_lb: "100.00",
        },
      ]);
    }
    return { quoteId: quote.id, version: quote.version, zone, target, executedBy };
  }

  it("uses the later ready date plus transit and does not book the day", async () => {
    const seeded = await seed();
    const before = await getDb()
      .select({
        truck: delivery_days.truck_code,
        stops: delivery_days.stops_booked,
        weight: delivery_days.weight_booked_lb,
      })
      .from(delivery_days)
      .where(eq(delivery_days.zone_code, seeded.zone));
    const result = await calculatePromiseById(seeded.quoteId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calculatedPromiseDate).toBe(seeded.target);
    expect(result.promiseDate).toBe(seeded.target);
    expect(result.promiseTruckCode).toBe("ROOMY");
    expect(result.promiseError).toBeNull();
    const after = await getDb()
      .select({
        truck: delivery_days.truck_code,
        stops: delivery_days.stops_booked,
        weight: delivery_days.weight_booked_lb,
      })
      .from(delivery_days)
      .where(eq(delivery_days.zone_code, seeded.zone));
    expect(after).toEqual(before);
  });

  it("stores no_capacity and no_zone without a date", async () => {
    const full = await seed({ withCapacity: false });
    await getDb().insert(delivery_days).values({
      service_date: full.target,
      truck_code: "PACKED",
      zone_code: full.zone,
      capacity_stops: 1,
      capacity_weight_lb: "50.00",
      stops_booked: 1,
      weight_booked_lb: "50.00",
    });
    const noRoom = await calculatePromiseById(full.quoteId);
    expect(noRoom.ok).toBe(true);
    if (!noRoom.ok) return;
    expect(noRoom.promiseError).toBe("no_capacity");
    expect(noRoom.calculatedPromiseDate).toBeNull();
    expect(noRoom.promiseDate).toBeNull();
    expect(noRoom.promiseTruckCode).toBeNull();

    const unzoned = await seed({ withZone: false });
    const missing = await calculatePromiseById(unzoned.quoteId);
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.promiseError).toBe("no_zone");
    expect(missing.calculatedPromiseDate).toBeNull();
  });

  it("blocks a configured line with no lead time and a stock line without an active hold", async () => {
    const untimed = await seed({ leadTimeDays: null, withCapacity: false, withZone: false });
    const missingLead = await calculatePromiseById(untimed.quoteId);
    expect(missingLead.ok).toBe(true);
    if (!missingLead.ok) return;
    expect(missingLead.promiseError).toMatch(/no lead time/);
    expect(missingLead.promiseDate).toBeNull();

    const released = await seed({ holdStatus: "released", withCapacity: false, withZone: false });
    const inactive = await calculatePromiseById(released.quoteId);
    expect(inactive.ok).toBe(true);
    if (!inactive.ok) return;
    expect(inactive.promiseError).toMatch(/active hold/);
  });

  it("uses the carrier transit days from the freight snapshot", async () => {
    const settings = await getLogisticsSettings();
    const transitDays = settings.fleetTransitDays === 4 ? 9 : 4;
    const seeded = await seed({ method: "PRIORITY1_LTL", transitDays });
    const result = await calculatePromiseById(seeded.quoteId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calculatedPromiseDate).toBe(seeded.target);
    expect(result.calculatedPromiseDate).not.toBe(
      addCalendarDays(addCalendarDays(seeded.executedBy, 3), settings.fleetTransitDays),
    );
  });

  it("keeps a manager date without booking capacity", async () => {
    const seeded = await seed();
    const rated = await calculatePromiseById(seeded.quoteId);
    expect(rated.ok).toBe(true);
    if (!rated.ok) return;
    const before = await getDb()
      .select({ stops: delivery_days.stops_booked })
      .from(delivery_days)
      .where(eq(delivery_days.zone_code, seeded.zone));
    const overrideDate = addCalendarDays(seeded.target, 14);
    const saved = await overrideQuotePromiseDate({
      quoteId: seeded.quoteId,
      expectedVersion: rated.version,
      promiseDate: overrideDate,
      reason: "Customer requested a later Tuesday",
      actor: { actorId: randomUUID(), role: "Ops_Manager" },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.promiseDate).toBe(overrideDate);
    const [row] = await getDb()
      .select({
        shown: quotes.promise_date,
        calculated: quotes.calculated_promise_date,
      })
      .from(quotes)
      .where(eq(quotes.id, seeded.quoteId));
    expect(String(row?.shown).slice(0, 10)).toBe(overrideDate);
    expect(String(row?.calculated).slice(0, 10)).toBe(seeded.target);
    const after = await getDb()
      .select({ stops: delivery_days.stops_booked })
      .from(delivery_days)
      .where(eq(delivery_days.zone_code, seeded.zone));
    expect(after).toEqual(before);

    const again = await calculatePromiseById(seeded.quoteId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.promiseDate).toBe(overrideDate);
    expect(again.calculatedPromiseDate).toBe(seeded.target);
  });
});
