"use server";

import { inArray } from "drizzle-orm";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { logistics_profiles } from "@/server/db/schema";
import { calculateFulfillmentOptions as planFulfillmentOptions } from "@/server/freight/fulfillment";
import {
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
  Priority1QuoteResult,
} from "@/types/freight";

async function requireSignedInOperator(): Promise<void> {
  const session = await getPimSession();
  if (!session?.email) {
    throw new FreightRatingError("Sign in required");
  }
}

/**
 * Signed-in Priority1 rate. Fails closed: with no PRIORITY1_API_KEY the broker call throws a
 * FreightRatingError. There is no mock or shadow rate table.
 */
export async function getPriority1Quote(
  skid: FreightSkid,
  originZip: string,
  destZip: string,
  accessorials: readonly Priority1AccessorialCode[],
): Promise<Priority1QuoteResult> {
  await requireSignedInOperator();
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
