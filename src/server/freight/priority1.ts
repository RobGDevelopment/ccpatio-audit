import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import { readPriority1ApiKey } from "@/lib/priority1-env";
import type {
  FreightSkid,
  FreightSkidItem,
  Priority1AccessorialCode,
  Priority1QuoteResult,
} from "@/types/freight";
import type {
  FreightClassType,
  QuoteLineItem,
  RateQuoteRequest,
  RateQuoteResponse,
} from "@/types/priority1-ltl.generated";

/** Scottsdale commercial dock. Nationwide LTL picks up here. */
export const CC_PATIO_PICKUP_ZIP = "85260";

export const PRIORITY1_RATES_URL =
  "https://api.priority1.com/v2/ltl/quotes/rates";

/** Mixed furniture skids are packed into this height band before rating. */
export const PACKED_SKID_HEIGHT_MIN_IN = 36;
export const PACKED_SKID_HEIGHT_MAX_IN = 45;

const ACCESSORIALS = new Set<Priority1AccessorialCode>([
  "RESDEL",
  "LGDEL",
  "APPT",
]);

const CLASS_SET = new Set<string>(LTL_FREIGHT_CLASSES);

export class Priority1ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Priority1 rate quote failed (${status}): ${body}`);
    this.name = "Priority1ApiError";
    this.status = status;
    this.body = body;
  }
}

export class FreightRatingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreightRatingError";
  }
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeZip(raw: string, label: string): string {
  const digits = raw.trim();
  if (!/^\d{5}$/.test(digits)) {
    throw new FreightRatingError(`${label} must be a 5-digit US ZIP`);
  }
  return digits;
}

function assertItem(item: FreightSkidItem, index: number): void {
  const where = `Skid item ${index + 1}`;
  if (item.packagingType !== "Pallet") {
    throw new FreightRatingError(`${where} must use packagingType Pallet`);
  }
  if (!CLASS_SET.has(item.freightClass)) {
    throw new FreightRatingError(
      `${where} has unknown NMFC class ${item.freightClass}`,
    );
  }
  for (const [label, value] of [
    ["weight", item.weight],
    ["length", item.length],
    ["width", item.width],
    ["height", item.height],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new FreightRatingError(`${where} ${label} must be greater than 0`);
    }
  }
  if (typeof item.isStackable !== "boolean") {
    throw new FreightRatingError(`${where} isStackable must be a boolean`);
  }
}

/**
 * Collapse every product on one physical skid into a single Priority1 line.
 * Weight is the sum. Footprint is the largest length and width. Packed height
 * is the stacked height and must land between 36 and 45 inches. The line uses
 * the highest NMFC class on the skid so the broker does not rate each product
 * as its own pallet.
 */
export function collapseMixedSkid(skid: FreightSkid): QuoteLineItem {
  if (!skid.items?.length) {
    throw new FreightRatingError("A skid needs at least one item");
  }

  skid.items.forEach(assertItem);

  let best: FreightClassType = skid.items[0].freightClass as FreightClassType;
  let bestValue = Number(best);
  let weight = 0;
  let height = 0;
  let length = 0;
  let width = 0;
  let stackable = true;

  for (const item of skid.items) {
    const classValue = Number(item.freightClass);
    if (classValue > bestValue) {
      bestValue = classValue;
      best = item.freightClass as FreightClassType;
    }
    weight += item.weight;
    height += item.height;
    length = Math.max(length, item.length);
    width = Math.max(width, item.width);
    stackable = stackable && item.isStackable;
  }

  const packedHeight = roundTo(height, 2);
  if (
    packedHeight < PACKED_SKID_HEIGHT_MIN_IN ||
    packedHeight > PACKED_SKID_HEIGHT_MAX_IN
  ) {
    throw new FreightRatingError(
      `Packed skid height is ${packedHeight} in. A mixed skid must pack between ${PACKED_SKID_HEIGHT_MIN_IN} and ${PACKED_SKID_HEIGHT_MAX_IN} in.`,
    );
  }

  return {
    freightClass: best,
    packagingType: "Pallet",
    units: 1,
    pieces: skid.items.length,
    totalWeight: roundTo(weight, 2),
    length: roundTo(length, 2),
    width: roundTo(width, 2),
    height: packedHeight,
    isStackable: stackable,
    isHazardous: false,
    isUsed: false,
    isMachinery: false,
  };
}

export function normalizeAccessorials(
  accessorials: readonly Priority1AccessorialCode[],
): Priority1AccessorialCode[] {
  const unique: Priority1AccessorialCode[] = [];
  for (const code of accessorials) {
    if (!ACCESSORIALS.has(code)) {
      throw new FreightRatingError(`Unsupported accessorial ${String(code)}`);
    }
    if (!unique.includes(code)) unique.push(code);
  }
  return unique;
}

/** Next weekday pickup in Phoenix, where the dock does not observe DST. */
export function nextBusinessPickupDate(now = new Date()): string {
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    weekday: "short",
  });

  let cursor = now.getTime();
  for (let step = 0; step < 10; step += 1) {
    cursor += 24 * 60 * 60 * 1000;
    const instant = new Date(cursor);
    const weekday = weekdayFmt.format(instant);
    if (weekday === "Sat" || weekday === "Sun") continue;
    return `${dateFmt.format(instant)}T00:00:00`;
  }
  throw new FreightRatingError("Could not resolve a business pickup date");
}

export function buildPriority1RateRequest(
  skid: FreightSkid,
  originZip: string,
  destZip: string,
  accessorials: readonly Priority1AccessorialCode[],
  pickupDate = nextBusinessPickupDate(),
): RateQuoteRequest {
  const line = collapseMixedSkid(skid);
  return {
    originZipCode: normalizeZip(originZip, "Origin ZIP"),
    destinationZipCode: normalizeZip(destZip, "Destination ZIP"),
    pickupDate,
    items: [line],
    accessorialServices: normalizeAccessorials(accessorials).map((code) => ({
      code,
    })),
  };
}

function parseRateResponse(body: unknown): RateQuoteResponse {
  if (!body || typeof body !== "object") {
    throw new Priority1ApiError(200, "Response was not a JSON object");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.id !== "number" || !Array.isArray(record.rateQuotes)) {
    throw new Priority1ApiError(200, "Response is missing id or rateQuotes");
  }
  return body as RateQuoteResponse;
}

/**
 * Rate one physical skid. The request always contains exactly one line item.
 */
export async function getPriority1Quote(
  skid: FreightSkid,
  originZip: string,
  destZip: string,
  accessorials: readonly Priority1AccessorialCode[],
): Promise<Priority1QuoteResult> {
  const request = buildPriority1RateRequest(
    skid,
    originZip,
    destZip,
    accessorials,
  );
  const apiKey = readPriority1ApiKey();
  if (!apiKey) {
    console.warn(
      "[MOCK MODE] Priority1 API key missing. Returning mocked LTL quote.",
    );
    const { shadowPriority1RateQuote } = await import(
      "@/server/actions/freight"
    );
    return { request, response: await shadowPriority1RateQuote(request) };
  }

  let response: Response;
  try {
    response = await fetch(PRIORITY1_RATES_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    throw new Priority1ApiError(0, message);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new Priority1ApiError(response.status, raw.slice(0, 2000));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Priority1ApiError(response.status, "Response was not JSON");
  }

  return { request, response: parseRateResponse(parsed) };
}
