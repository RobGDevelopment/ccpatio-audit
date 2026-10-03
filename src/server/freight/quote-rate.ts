import { createHash } from "node:crypto";
import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import {
  CC_PATIO_PICKUP_ZIP,
  FreightRatingError,
  PACKED_SKID_HEIGHT_MAX_IN,
  PACKED_SKID_HEIGHT_MIN_IN,
} from "@/server/freight/priority1";
import type {
  FreightSkid,
  FulfillmentMethod,
  FulfillmentOption,
  FulfillmentPlan,
} from "@/types/freight";

export const FREIGHT_SUCCESS_TTL_MS = 20 * 60 * 1000;
export const FREIGHT_FAILURE_TTL_MS = 60 * 1000;

const FREIGHT_ACCESSORIALS = ["APPT", "LGDEL", "RESDEL"] as const;
const CLASS_SET = new Set<string>(LTL_FREIGHT_CLASSES);

export type FreightTariffSettings = {
  localWhiteGloveFee: number;
  localRadiusMiles: number;
  fleetMaxRadiusMiles: number;
  ltlHandlingMarkupPct: number;
  fleetBaseFee: number | null;
  fleetPerMile: number | null;
  fleetPerPound: number | null;
};

export type RatedLineInput = {
  sku: string;
  qty: number;
  unitWeightLb: number;
  freightClass: string;
  lengthIn: number;
  widthIn: number;
};

type Json =
  | null
  | string
  | number
  | boolean
  | Json[]
  | { [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
    .join(",")}}`;
}

export function freightCacheExpiry(kind: "success" | "failure", now: Date): Date {
  const ttl = kind === "success" ? FREIGHT_SUCCESS_TTL_MS : FREIGHT_FAILURE_TTL_MS;
  return new Date(now.getTime() + ttl);
}

export function freightCacheFresh(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

export function assertPackedHeight(height: number): number {
  if (!Number.isFinite(height)) {
    throw new FreightRatingError(
      `Packed skid height must be between ${PACKED_SKID_HEIGHT_MIN_IN} and ${PACKED_SKID_HEIGHT_MAX_IN} in.`,
    );
  }
  const packed = Math.round((height + Number.EPSILON) * 100) / 100;
  if (packed < PACKED_SKID_HEIGHT_MIN_IN || packed > PACKED_SKID_HEIGHT_MAX_IN) {
    throw new FreightRatingError(
      `Packed skid height is ${packed} in. A mixed skid must pack between ${PACKED_SKID_HEIGHT_MIN_IN} and ${PACKED_SKID_HEIGHT_MAX_IN} in.`,
    );
  }
  return packed;
}

export function isKnownFreightClass(value: string): boolean {
  return CLASS_SET.has(value);
}

function moneyOrNull(value: number | null, places: number): string | null {
  if (value == null) return null;
  return value.toFixed(places);
}

function hashItems(lines: RatedLineInput[]): Json[] {
  return lines
    .map((line) => ({
      class: line.freightClass,
      length: line.lengthIn.toFixed(4),
      qty: line.qty.toFixed(4),
      sku: line.sku,
      weight: (line.unitWeightLb * line.qty).toFixed(4),
      width: line.widthIn.toFixed(4),
    }))
    .sort((left, right) => {
      const sku = String(left.sku).localeCompare(String(right.sku));
      if (sku !== 0) return sku;
      return String(left.qty).localeCompare(String(right.qty));
    });
}

/** SHA-256 of the canonical freight inputs. Settings are inside so a tariff change misses the cache. */
export function freightInputHash(input: {
  destinationZip: string;
  distanceMiles: number;
  packedHeightIn: number;
  lines: RatedLineInput[];
  settings: FreightTariffSettings;
}): string {
  const body: { [key: string]: Json } = {
    accessorials: [...FREIGHT_ACCESSORIALS],
    destinationZip: input.destinationZip,
    distanceMiles: input.distanceMiles.toFixed(2),
    fleetBaseFee: moneyOrNull(input.settings.fleetBaseFee, 2),
    fleetMaxRadiusMiles: input.settings.fleetMaxRadiusMiles,
    fleetPerMile: moneyOrNull(input.settings.fleetPerMile, 2),
    fleetPerPound: moneyOrNull(input.settings.fleetPerPound, 4),
    items: hashItems(input.lines),
    localRadiusMiles: input.settings.localRadiusMiles,
    localWhiteGloveFee: input.settings.localWhiteGloveFee.toFixed(2),
    ltlHandlingMarkupPct: input.settings.ltlHandlingMarkupPct.toFixed(2),
    originZip: CC_PATIO_PICKUP_ZIP,
    packedHeight: input.packedHeightIn.toFixed(2),
    skidCount: 1,
  };
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/**
 * One pallet. Footprint is the max length and width. Weight is the sum of
 * line weight times quantity. Packed height is the quote's height once,
 * not a sum of product heights and not a 90×40 stand-in.
 */
export function buildPalletSkid(
  lines: RatedLineInput[],
  packedHeightIn: number,
): FreightSkid {
  const height = assertPackedHeight(packedHeightIn);
  if (lines.length === 0) {
    throw new FreightRatingError("A quote with no shippable lines is not rated.");
  }
  let weight = 0;
  let length = 0;
  let width = 0;
  let best = lines[0]?.freightClass ?? "";
  let bestValue = Number(best);
  for (const line of lines) {
    weight += line.unitWeightLb * line.qty;
    length = Math.max(length, line.lengthIn);
    width = Math.max(width, line.widthIn);
    const value = Number(line.freightClass);
    if (value > bestValue) {
      bestValue = value;
      best = line.freightClass;
    }
  }
  return {
    items: [
      {
        freightClass: best,
        weight: Math.round((weight + Number.EPSILON) * 100) / 100,
        length: Math.round((length + Number.EPSILON) * 100) / 100,
        width: Math.round((width + Number.EPSILON) * 100) / 100,
        height,
        packagingType: "Pallet",
        isStackable: true,
      },
    ],
  };
}

export function selectAppliedOption(
  plan: FulfillmentPlan,
  preferred: FulfillmentMethod | null,
): FulfillmentOption {
  const byMethod = new Map(plan.options.map((option) => [option.method, option]));
  const whiteGlove = byMethod.get("LOCAL_WHITE_GLOVE");
  if (whiteGlove) return whiteGlove;
  const fleet = byMethod.get("INTERNAL_FLEET");
  const ltl = byMethod.get("PRIORITY1_LTL");
  if (fleet) {
    if (preferred === "PRIORITY1_LTL" && ltl) return ltl;
    return fleet;
  }
  if (ltl) return ltl;
  throw new FreightRatingError("No freight option applies to this shipment.");
}

export function isFulfillmentPlan(value: unknown): value is FulfillmentPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as FulfillmentPlan;
  return typeof plan.destinationZip === "string" && Array.isArray(plan.options);
}
