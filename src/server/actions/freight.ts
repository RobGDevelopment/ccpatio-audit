"use server";

import { inArray } from "drizzle-orm";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { logistics_profiles } from "@/server/db/schema";
import { calculateFulfillmentOptions as planFulfillmentOptions } from "@/server/freight/fulfillment";
import { readPriority1ApiKey } from "@/lib/priority1-env";
import {
  buildPriority1RateRequest,
  FreightRatingError,
  getPriority1Quote as requestPriority1Quote,
} from "@/server/freight/priority1";
import {
  buildPalletSkid,
  isKnownFreightClass,
  type RatedLineInput,
} from "@/server/freight/quote-rate";
import type {
  FreightSkid,
  FulfillmentPlan,
  Priority1AccessorialCode,
} from "@/types/freight";
import type {
  RateQuoteRequest,
  RateQuoteResponse,
} from "@/types/priority1-ltl.generated";

const FALLBACK_FREIGHT_MATRIX = [
  { region: "Southern California", zipPrefixes: ["90", "91", "92"], estimatedCost: 695.00, transitDays: 2 },
  { region: "Pacific Northwest", zipPrefixes: ["97", "98"], estimatedCost: 880.00, transitDays: 5 },
  { region: "Mountain West", zipPrefixes: ["80", "81", "84", "87", "88", "89"], estimatedCost: 740.00, transitDays: 3 },
  { region: "Texas / South Central", zipPrefixes: ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"], estimatedCost: 940.00, transitDays: 4 },
  { region: "Midwest", zipPrefixes: ["43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69"], estimatedCost: 960.00, transitDays: 5 },
  { region: "Southeast", zipPrefixes: ["27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39"], estimatedCost: 1150.00, transitDays: 6 },
  { region: "Northeast", zipPrefixes: ["0", "1"], estimatedCost: 1230.00, transitDays: 7 }
];

type ShadowLane = (typeof FALLBACK_FREIGHT_MATRIX)[number];

/** Longest ZIP prefix wins. Unlisted destinations use the highest padded lane. */
function matchShadowLane(destZip: string): ShadowLane & { matched: boolean } {
  const zip = destZip.trim();
  let match: { lane: ShadowLane; prefixLength: number } | null = null;
  for (const lane of FALLBACK_FREIGHT_MATRIX) {
    for (const prefix of lane.zipPrefixes) {
      if (!zip.startsWith(prefix)) continue;
      if (!match || prefix.length > match.prefixLength) {
        match = { lane, prefixLength: prefix.length };
      }
    }
  }
  if (match) return { ...match.lane, matched: true };
  const padded = FALLBACK_FREIGHT_MATRIX.reduce((highest, lane) =>
    lane.estimatedCost > highest.estimatedCost ? lane : highest,
  );
  return {
    region: "Unlisted destination",
    zipPrefixes: padded.zipPrefixes,
    estimatedCost: padded.estimatedCost,
    transitDays: padded.transitDays,
    matched: false,
  };
}

export async function shadowPriority1RateQuote(
  request: RateQuoteRequest,
): Promise<RateQuoteResponse> {
  const lane = matchShadowLane(request.destinationZipCode);
  const line = request.items[0];
  return {
    id: 900001,
    rateQuotes: [
      {
        id: 900002,
        carrierName: "Priority1",
        carrierCode: "P1",
        serviceLevel: "STANDARD",
        serviceLevelDescription: lane.region,
        transitDays: lane.transitDays,
        laneType: "DIRECT",
        deliveryDate: null,
        effectiveDate: null,
        expirationDate: null,
        totalNewCarrierLiabilityAmount: 0,
        totalUsedCarrierLiabilityAmount: 0,
        totalMachineryCarrierLiabilityAmount: 0,
        carrierQuoteNumber: `P1-${lane.estimatedCost.toFixed(0)}`,
        rateQuoteDetail: {
          total: lane.estimatedCost,
          baseCost: lane.estimatedCost,
          charges: [
            {
              code: "ITEM",
              description: `${lane.region} shadow all-in rate`,
              amount: lane.estimatedCost,
            },
          ],
        },
        mode: "LTL",
        message: lane.matched
          ? `Shadow rate for ${lane.region}.`
          : "Destination ZIP is outside the shadow matrix. Using the highest padded lane.",
      },
    ],
    invalidRateQuotes: [],
    rateQuoteRequestDetail: {
      originZipCode: request.originZipCode,
      destinationZipCode: request.destinationZipCode,
      pickupDate: request.pickupDate,
      items: request.items,
      accessorialServices: request.accessorialServices ?? null,
      totalWeight: line?.totalWeight,
    },
    messages: [
      {
        severity: "Warning",
        text: "Mocked LTL quote. PRIORITY1_API_KEY is not set.",
        source: "ccpatio",
      },
    ],
  };
}

async function requireSignedInOperator(): Promise<void> {
  const session = await getPimSession();
  if (!session?.email) {
    throw new FreightRatingError("Sign in required");
  }
}

export async function getPriority1Quote(
  skid: FreightSkid,
  originZip: string,
  destZip: string,
  accessorials: readonly Priority1AccessorialCode[],
): Promise<{ request: RateQuoteRequest; response: RateQuoteResponse }> {
  await requireSignedInOperator();
  const request = buildPriority1RateRequest(
    skid,
    originZip,
    destZip,
    accessorials,
  );
  if (!readPriority1ApiKey()) {
    console.warn(
      "[MOCK MODE] Priority1 API key missing. Returning mocked LTL quote.",
    );
    return { request, response: await shadowPriority1RateQuote(request) };
  }
  return requestPriority1Quote(skid, originZip, destZip, accessorials);
}

/**
 * Signed-in wrapper. Routing rules live in the freight port and are unchanged:
 * local white-glove, then fleet plus Priority1, then Priority1 only.
 */
export async function calculateFulfillmentOptions(
  destZip: string,
  distanceMiles: number,
  skid: FreightSkid,
  accessorials?: readonly Priority1AccessorialCode[],
): Promise<FulfillmentPlan> {
  await requireSignedInOperator();
  return planFulfillmentOptions(destZip, distanceMiles, skid, accessorials);
}

const DEFAULT_PACKED_HEIGHT_IN = 40;

/**
 * Rate catalog SKUs from logistics_profiles. The client sends identities only.
 * Packaged length, width, weight, and NMFC class are read again at quote time.
 */
export async function rateProductsFromLogisticsProfiles(input: {
  destZip: string;
  distanceMiles: number;
  variantSkus: readonly string[];
}): Promise<FulfillmentPlan> {
  await requireSignedInOperator();
  const requested = input.variantSkus.map((sku) => sku.trim().toUpperCase());
  if (requested.length === 0 || requested.some((sku) => sku.length === 0)) {
    throw new FreightRatingError("Add at least one product.");
  }

  const qtyBySku = new Map<string, number>();
  for (const sku of requested) {
    qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + 1);
  }

  const db = getDb();
  const rows = await db
    .select({
      variantSku: logistics_profiles.variant_sku,
      weightLb: logistics_profiles.weight_lb,
      ltlClass: logistics_profiles.ltl_class,
      lengthIn: logistics_profiles.length_in,
      widthIn: logistics_profiles.width_in,
    })
    .from(logistics_profiles)
    .where(inArray(logistics_profiles.variant_sku, [...qtyBySku.keys()]));
  const bySku = new Map(rows.map((row) => [row.variantSku, row]));

  const lines: RatedLineInput[] = [];
  for (const [sku, qty] of qtyBySku) {
    const profile = bySku.get(sku);
    const weight = Number(profile?.weightLb);
    const length = Number(profile?.lengthIn);
    const width = Number(profile?.widthIn);
    const freightClass = profile?.ltlClass?.trim() ?? "";
    if (
      !profile ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      !Number.isFinite(length) ||
      length <= 0 ||
      !Number.isFinite(width) ||
      width <= 0 ||
      !isKnownFreightClass(freightClass)
    ) {
      throw new FreightRatingError(
        `${sku} is missing weight, NMFC class, length, or width in the logistics catalog.`,
      );
    }
    lines.push({
      sku,
      qty,
      unitWeightLb: weight,
      freightClass,
      lengthIn: length,
      widthIn: width,
    });
  }

  const skid = buildPalletSkid(lines, DEFAULT_PACKED_HEIGHT_IN);
  return planFulfillmentOptions(input.destZip, input.distanceMiles, skid);
}
