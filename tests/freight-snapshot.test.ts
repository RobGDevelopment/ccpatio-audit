import { readFileSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import {
  dock_distances,
  freight_rate_cache,
  logistics_profiles,
  quote_line_items,
  quote_overrides,
  quotes,
} from "@/server/db/schema";
import {
  dockDistanceFresh,
  DOCK_DISTANCE_TTL_MS,
  geocodeUsZip,
  haversineMiles,
  lookupDockDistance,
} from "@/server/freight/distance";
import {
  fleetCustomerTotal,
  requireFleetTariff,
} from "@/server/freight/fleet-tariff";
import {
  assertPackedHeight,
  buildPalletSkid,
  freightCacheExpiry,
  freightCacheFresh,
  freightInputHash,
  FREIGHT_FAILURE_TTL_MS,
  FREIGHT_SUCCESS_TTL_MS,
  selectAppliedOption,
  type FreightTariffSettings,
  type RatedLineInput,
} from "@/server/freight/quote-rate";
import { commercialOverrideAllowed } from "@/server/quotes/override-role";
import {
  rateQuoteById,
  selectQuoteFreightMethodById,
} from "@/server/quotes/rate-freight";
import type { FulfillmentPlan } from "@/types/freight";

const settings: FreightTariffSettings = {
  localWhiteGloveFee: 150,
  localRadiusMiles: 50,
  fleetMaxRadiusMiles: 500,
  ltlHandlingMarkupPct: 15,
  fleetBaseFee: 100,
  fleetPerMile: 2,
  fleetPerPound: 0.5,
};

function line(sku: string, qty = 1): RatedLineInput {
  return {
    sku,
    qty,
    unitWeightLb: 40,
    freightClass: "175",
    lengthIn: 72,
    widthIn: 34,
  };
}

function planFor(destZip: string, miles: number): FulfillmentPlan {
  return {
    originZip: "85260",
    destinationZip: destZip,
    distanceMiles: miles,
    options: [
      {
        method: "INTERNAL_FLEET",
        priceUsd: 100,
        currency: "USD",
        summary: "truck",
      },
      {
        method: "PRIORITY1_LTL",
        priceUsd: 250,
        currency: "USD",
        summary: "ltl",
        carriers: [
          {
            id: 1,
            carrierName: "Example Carrier",
            carrierCode: "XPO",
            transitDays: 3,
            serviceLevel: "STD",
            brokerTotalUsd: 200,
            customerTotalUsd: 250,
          },
        ],
      },
    ],
  };
}

describe("freight snapshot math", () => {
  it("hashes the same skid regardless of line order and changes when miles change", () => {
    const first = freightInputHash({
      destinationZip: "85251",
      distanceMiles: 12.5,
      packedHeightIn: 40,
      lines: [line("BRA-1"), line("BRA-2", 2)],
      settings,
    });
    const second = freightInputHash({
      destinationZip: "85251",
      distanceMiles: 12.5,
      packedHeightIn: 40,
      lines: [line("BRA-2", 2), line("BRA-1")],
      settings,
    });
    const farther = freightInputHash({
      destinationZip: "85251",
      distanceMiles: 12.51,
      packedHeightIn: 40,
      lines: [line("BRA-1"), line("BRA-2", 2)],
      settings,
    });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(farther).not.toBe(first);
  });

  it("prices the company truck from base, miles, and weight", () => {
    expect(
      fleetCustomerTotal(
        { fleetBaseFee: 50, fleetPerMile: 1.5, fleetPerPound: 0.25 },
        10,
        8,
      ),
    ).toBe(67);
    expect(() =>
      requireFleetTariff({
        fleetBaseFee: null,
        fleetPerMile: 1,
        fleetPerPound: 1,
      }),
    ).toThrow(/fleet_base_fee/);
  });

  it("refuses packed height outside 36 to 45 and does not invent a 90 by 40 pallet", () => {
    expect(() => assertPackedHeight(35)).toThrow(/36/);
    expect(() => assertPackedHeight(46)).toThrow(/45/);
    expect(assertPackedHeight(40)).toBe(40);
    const skid = buildPalletSkid(
      [
        { ...line("A"), lengthIn: 80, widthIn: 30, unitWeightLb: 25 },
        { ...line("B"), lengthIn: 60, widthIn: 36, unitWeightLb: 15, qty: 2 },
      ],
      40,
    );
    expect(skid.items).toHaveLength(1);
    expect(skid.items[0]).toMatchObject({
      height: 40,
      length: 80,
      width: 36,
      weight: 55,
      freightClass: "175",
    });
    expect(skid.items[0]?.length).not.toBe(90);
  });

  it("keeps a success cache for 20 minutes and a failure cache for 60 seconds", () => {
    const now = new Date("2026-10-02T15:00:00Z");
    expect(freightCacheFresh(now, now)).toBe(false);
    expect(freightCacheFresh(freightCacheExpiry("success", now), now)).toBe(true);
    expect(
      freightCacheFresh(
        freightCacheExpiry("success", now),
        new Date(now.getTime() + FREIGHT_SUCCESS_TTL_MS - 1),
      ),
    ).toBe(true);
    expect(
      freightCacheFresh(
        freightCacheExpiry("failure", now),
        new Date(now.getTime() + FREIGHT_FAILURE_TTL_MS - 1),
      ),
    ).toBe(true);
    expect(
      freightCacheFresh(
        freightCacheExpiry("failure", now),
        new Date(now.getTime() + FREIGHT_FAILURE_TTL_MS),
      ),
    ).toBe(false);
  });

  it("applies white-glove, fleet, or the chosen LTL quote", () => {
    const local: FulfillmentPlan = {
      originZip: "85260",
      destinationZip: "85251",
      distanceMiles: 10,
      options: [
        {
          method: "LOCAL_WHITE_GLOVE",
          priceUsd: 150,
          currency: "USD",
          summary: "local",
        },
      ],
    };
    expect(selectAppliedOption(local, "PRIORITY1_LTL").method).toBe(
      "LOCAL_WHITE_GLOVE",
    );
    const fleet = planFor("90001", 200);
    expect(selectAppliedOption(fleet, null).method).toBe("INTERNAL_FLEET");
    expect(selectAppliedOption(fleet, "PRIORITY1_LTL").method).toBe(
      "PRIORITY1_LTL",
    );
    const beyond: FulfillmentPlan = {
      ...fleet,
      options: fleet.options.filter((option) => option.method === "PRIORITY1_LTL"),
    };
    expect(selectAppliedOption(beyond, "INTERNAL_FLEET").method).toBe(
      "PRIORITY1_LTL",
    );
  });

  it("rejects the embed principal and non-manager roles", () => {
    expect(
      commercialOverrideAllowed({
        email: "ghl-embed@ccpatio.com",
        role: "SuperAdmin",
      }),
    ).toBe(false);
    expect(
      commercialOverrideAllowed({ email: "ops@ccpatio.com", role: "Designer" }),
    ).toBe(false);
    expect(
      commercialOverrideAllowed({ email: "ops@ccpatio.com", role: null }),
    ).toBe(false);
    expect(
      commercialOverrideAllowed({
        email: "ops@ccpatio.com",
        role: "Ops_Manager",
      }),
    ).toBe(true);
    expect(
      commercialOverrideAllowed({
        email: "root@ccpatio.com",
        role: "SuperAdmin",
      }),
    ).toBe(true);
  });

  it("does not keep the ZIP-prefix distance stub", () => {
    const dispatch = readFileSync("src/server/actions/dispatch.ts", "utf8");
    const orderDesk = readFileSync("src/server/actions/order-desk.ts", "utf8");
    const portal = readFileSync(
      "src/app/embed/order-desk/OrderDeskPortal.tsx",
      "utf8",
    );
    expect(dispatch).not.toContain("getEstimatedDistance");
    expect(dispatch).not.toContain('startsWith("85")');
    expect(dispatch).not.toContain("1200");
    expect(orderDesk).not.toContain("getEstimatedDistance");
    expect(orderDesk).toContain("rateQuoteFreight");
    expect(portal).toContain("FREIGHT_DEBOUNCE_MS = 1500");
    expect(portal).toContain("rateQuoteFreight");
    expect(portal).toContain("order-desk-freight-method");
    expect(portal).toContain("order-desk-freight-total");
  });
});

describe("dock distance cache", () => {
  const dest = "99901";

  afterEach(async () => {
    const db = getDb();
    await db.delete(dock_distances).where(eq(dock_distances.dest_zip, dest));
    await closeDb();
  });

  it("stores a geocode and reuses it for 30 days", async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async (input) => {
      fetches += 1;
      const url = String(input);
      const zip = url.slice(url.lastIndexOf("/") + 1);
      const points: Record<string, [string, string]> = {
        "85260": ["33.6119", "-111.8906"],
        "99901": ["55.3422", "-131.6461"],
      };
      const point = points[zip];
      if (!point) return new Response("missing", { status: 404 });
      return new Response(
        JSON.stringify({ places: [{ latitude: point[0], longitude: point[1] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const now = new Date("2026-10-02T15:00:00Z");
    const first = await lookupDockDistance(dest, { fetchImpl, now });
    const afterFirst = fetches;
    const second = await lookupDockDistance(dest, { fetchImpl, now });
    expect(first?.source).toBe("geocode");
    expect(first?.miles).toBeGreaterThan(0);
    expect(second?.miles).toBe(first?.miles);
    expect(fetches).toBe(afterFirst);
    expect(
      haversineMiles(
        { lat: 33.6119, lng: -111.8906 },
        { lat: 33.6119, lng: -111.8906 },
      ),
    ).toBe(0);
    expect(dockDistanceFresh(now, new Date(now.getTime() + DOCK_DISTANCE_TTL_MS))).toBe(
      false,
    );

    const db = getDb();
    await db
      .update(dock_distances)
      .set({ fetched_at: new Date(now.getTime() - DOCK_DISTANCE_TTL_MS - 1000) })
      .where(eq(dock_distances.dest_zip, dest));
    const third = await lookupDockDistance(dest, { fetchImpl, now });
    expect(third?.miles).toBe(first?.miles);
    expect(fetches).toBeGreaterThan(afterFirst);

    const missing = await geocodeUsZip("00000", fetchImpl);
    expect(missing).toBeNull();
  });
});

describe("order desk freight rater", () => {
  const created: string[] = [];
  const zips: string[] = [];
  const variants: number[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const zip of zips) {
      await db.delete(freight_rate_cache).where(eq(freight_rate_cache.dest_zip, zip));
      await db.delete(dock_distances).where(eq(dock_distances.dest_zip, zip));
    }
    for (const quoteId of created) {
      await db
        .update(quotes)
        .set({ freight_override_id: null })
        .where(eq(quotes.id, quoteId));
      await db.delete(quote_overrides).where(eq(quote_overrides.quote_id, quoteId));
      await db.delete(quotes).where(eq(quotes.id, quoteId));
    }
    for (const variantId of variants) {
      await db
        .delete(logistics_profiles)
        .where(eq(logistics_profiles.katana_variant_id, variantId));
    }
    created.length = 0;
    zips.length = 0;
    variants.length = 0;
    await closeDb();
  });

  async function seedQuote(input?: {
    zip?: string;
    withProfile?: boolean;
    distanceMiles?: string | null;
    distanceSource?: "geocode" | "manual_override" | null;
  }) {
    const db = getDb();
    const zip = input?.zip ?? "00021";
    const variantId = randomInt(1, 2_000_000_000);
    const sku = `QA-FRT-${randomUUID().slice(0, 8).toUpperCase()}`;
    zips.push(zip);
    variants.push(variantId);
    if (input?.withProfile !== false) {
      await db.insert(logistics_profiles).values({
        katana_variant_id: variantId,
        variant_sku: sku,
        length_in: "72.0000",
        width_in: "34.0000",
        weight_lb: "40.0000",
        ltl_class: "175",
      });
    }
    const [quote] = await db
      .insert(quotes)
      .values({
        ghl_opportunity_id: `qa-frt-${randomUUID()}`,
        ghl_contact_id: "qa-contact",
        ghl_opportunity_name: "QA Freight",
        ghl_user_id: "qa-user",
        ghl_user_name: "QA User",
        status: "draft",
        dest_zip: zip,
        distance_miles: input?.distanceMiles,
        distance_source: input?.distanceSource,
        executed_by: "2026-10-02",
      })
      .returning({ id: quotes.id });
    if (!quote) throw new Error("quote was not inserted");
    created.push(quote.id);
    await db.insert(quote_line_items).values({
      quote_id: quote.id,
      line_no: 1,
      line_kind: "stock_hold",
      sku,
      katana_variant_id: variantId,
      qty: "1.0000",
      unit_price: "100.00",
      description: "QA chair",
    });
    return { quoteId: quote.id, zip, variantId };
  }

  it("does not call the planner twice inside the success cache window", async () => {
    const { quoteId, zip } = await seedQuote();
    let calls = 0;
    const clock = new Date("2026-10-02T15:00:00Z");
    const deps = {
      now: () => clock,
      measureDistance: async () => ({ miles: 200 }),
      plan: async () => {
        calls += 1;
        return planFor(zip, 200);
      },
    };
    const first = await rateQuoteById(quoteId, { destZip: zip }, deps);
    const second = await rateQuoteById(quoteId, { destZip: zip }, deps);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.freightMethod).toBe("INTERNAL_FLEET");
    expect(first.freightTotal).toBe("100.00");
    expect(first.calculatedFreightTotal).toBe("100.00");
    expect(second.freightTotal).toBe("100.00");
    expect(calls).toBe(1);

    const db = getDb();
    await db
      .update(freight_rate_cache)
      .set({ expires_at: new Date(clock.getTime() - 1000) })
      .where(eq(freight_rate_cache.dest_zip, zip));
    await rateQuoteById(quoteId, { destZip: zip }, deps);
    expect(calls).toBe(2);

    const switched = await selectQuoteFreightMethodById(
      quoteId,
      "PRIORITY1_LTL",
      clock,
    );
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.freightMethod).toBe("PRIORITY1_LTL");
    expect(switched.calculatedFreightTotal).toBe("250.00");
    expect(calls).toBe(2);
  });

  it("caches a planner failure for 60 seconds", async () => {
    const { quoteId, zip } = await seedQuote({ zip: "00022" });
    let calls = 0;
    let clock = new Date("2026-10-02T15:00:00Z");
    const deps = {
      now: () => clock,
      measureDistance: async () => ({ miles: 200 }),
      plan: async () => {
        calls += 1;
        throw new Error("Priority1 returned no rate quotes.");
      },
    };
    const failed = await rateQuoteById(quoteId, { destZip: zip }, deps);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.freightTotal).toBeNull();
    expect(failed.freightError).toMatch(/no rate quotes/);
    clock = new Date(clock.getTime() + 10_000);
    await rateQuoteById(quoteId, { destZip: zip }, deps);
    expect(calls).toBe(1);
    clock = new Date(clock.getTime() + FREIGHT_FAILURE_TTL_MS);
    await rateQuoteById(quoteId, { destZip: zip }, deps);
    expect(calls).toBe(2);
  });

  it("leaves the total empty when class or miles are missing", async () => {
    const missing = await seedQuote({ zip: "00023", withProfile: false });
    let planned = 0;
    const refused = await rateQuoteById(
      missing.quoteId,
      { destZip: missing.zip },
      {
        measureDistance: async () => {
          throw new Error("should not measure");
        },
        plan: async () => {
          planned += 1;
          return planFor(missing.zip, 10);
        },
      },
    );
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(refused.freightTotal).toBeNull();
    expect(refused.freightError).toMatch(/missing weight, class, length, or width/);
    expect(planned).toBe(0);

    const unknown = await seedQuote({ zip: "00024" });
    const noMiles = await rateQuoteById(
      unknown.quoteId,
      { destZip: unknown.zip },
      {
        measureDistance: async () => null,
        plan: async () => {
          planned += 1;
          return planFor(unknown.zip, 10);
        },
      },
    );
    expect(noMiles.ok).toBe(true);
    if (!noMiles.ok) return;
    expect(noMiles.freightTotal).toBeNull();
    expect(noMiles.freightError).toBe("No measured miles for this ZIP.");
    expect(planned).toBe(0);
  });

  it("keeps an override total and does not overwrite measured miles", async () => {
    const db = getDb();
    const { quoteId, zip } = await seedQuote({
      zip: "00025",
      distanceMiles: "200.00",
      distanceSource: "manual_override",
    });
    await db.insert(dock_distances).values({
      dest_zip: zip,
      origin_zip: "85260",
      distance_miles: "10.00",
      source: "geocode",
      fetched_at: new Date("2026-10-02T15:00:00Z"),
    });
    let seenMiles = 0;
    const rated = await rateQuoteById(quoteId, {}, {
      measureDistance: async () => {
        throw new Error("override miles must not geocode");
      },
      plan: async (_zip, miles) => {
        seenMiles = miles;
        return planFor(zip, miles);
      },
    });
    expect(rated.ok).toBe(true);
    if (!rated.ok) return;
    expect(seenMiles).toBe(200);
    expect(rated.calculatedFreightTotal).toBe("100.00");
    const [dock] = await db
      .select({ miles: dock_distances.distance_miles })
      .from(dock_distances)
      .where(eq(dock_distances.dest_zip, zip));
    expect(Number(dock?.miles)).toBe(10);

    const [override] = await db
      .insert(quote_overrides)
      .values({
        quote_id: quoteId,
        field: "freight_total",
        calculated_value: "100.00",
        override_value: "80.00",
        reason: "Manager price",
        actor_id: randomUUID(),
        actor_role: "Ops_Manager",
      })
      .returning({ id: quote_overrides.id });
    if (!override) throw new Error("override was not inserted");
    await db
      .update(quotes)
      .set({ freight_override_id: override.id, freight_total: "80.00" })
      .where(eq(quotes.id, quoteId));

    const again = await rateQuoteById(quoteId, {}, {
      measureDistance: async () => {
        throw new Error("override miles must not geocode");
      },
      plan: async (_zip, miles) => planFor(zip, miles),
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.freightTotal).toBe("80.00");
    expect(again.calculatedFreightTotal).toBe("100.00");
    const [still] = await db
      .select({ miles: dock_distances.distance_miles })
      .from(dock_distances)
      .where(eq(dock_distances.dest_zip, zip));
    expect(Number(still?.miles)).toBe(10);
  });
});
