/**
 * WooCommerce checkout LTL quote engine for POST /api/shipping/quote.
 *
 * Resolves Hub catalog dims → consolidates into 90×40×45 pallets → rates FedEx
 * LTL (Residential + Liftgate) with a hard 4500ms timeout and a deterministic
 * zone/pallet fallback so checkout is never blocked.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { inArray, or } from "drizzle-orm";
import {
  FedExFreightError,
  getFedExFreightQuote,
  isFedExFreightConfigured,
  type FedExDeps,
} from "@/lib/freight/fedex-freight";
import { timingSafeEqualString } from "@/lib/embed-auth";
import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import { getDb } from "@/server/db/client";
import {
  catalog_ship_profiles,
  ecommerce_listings,
  finished_goods_catalog,
  sku_aliases,
} from "@/server/db/schema";

/** Phoenix factory ship-from (TaxJar + FedEx LTL origin). Override via env. */
export const CCPATIO_FREIGHT_ORIGIN_ZIP = "85043";

export const LTL_PALLET_MAX_LENGTH_IN = 90;
export const LTL_PALLET_MAX_WIDTH_IN = 40;
export const LTL_PALLET_MAX_HEIGHT_IN = 45;
/** Wooden pallet + crating tare per LTL skid. */
export const LTL_PALLET_TARE_LB = 45;

export const FEDEX_QUOTE_TIMEOUT_MS = 4500;
export const QUOTE_TTL_MS = 15 * 60 * 1000;

export const RATE_ID_FEDEX_LTL = "ccpatio_fedex_ltl_curbside";
export const RATE_ID_PICKUP_SCOTTSDALE = "ccpatio_pickup_scottsdale";
export const RATE_ID_PICKUP_SOLANA = "ccpatio_pickup_solana";

export const RATE_LABEL_FEDEX_LTL =
  "FedEx LTL Curbside Freight (Residential & Liftgate Included)";
export const RATE_LABEL_PICKUP_SCOTTSDALE =
  "Showroom Pickup — Scottsdale, AZ (15037 N Scottsdale Rd)";
export const RATE_LABEL_PICKUP_SOLANA =
  "Showroom Pickup — Solana Beach, CA (312 S. Cedros Ave)";

/** Safe category fallbacks when a SKU lacks freight dims (e.g. Kindle/Tropics). */
export const FALLBACK_DIMS_BY_CATEGORY: Readonly<
  Record<string, { lengthIn: number; widthIn: number; heightIn: number; weightLb: number }>
> = {
  seating: { lengthIn: 84, widthIn: 36, heightIn: 32, weightLb: 120 },
  table: { lengthIn: 72, widthIn: 40, heightIn: 18, weightLb: 95 },
  lounger: { lengthIn: 80, widthIn: 30, heightIn: 20, weightLb: 85 },
  heater: { lengthIn: 24, widthIn: 24, heightIn: 48, weightLb: 55 },
  lamp: { lengthIn: 18, widthIn: 18, heightIn: 36, weightLb: 25 },
  umbrella: { lengthIn: 90, widthIn: 12, heightIn: 12, weightLb: 35 },
  parcel: { lengthIn: 18, widthIn: 14, heightIn: 8, weightLb: 8 },
  default: { lengthIn: 60, widthIn: 36, heightIn: 30, weightLb: 90 },
};

/** Distance bands from AZ for deterministic fallback LTL. */
const STATE_BAND: Readonly<Record<string, 1 | 2 | 3 | 4 | 5>> = {
  AZ: 1,
  NM: 1,
  NV: 1,
  UT: 1,
  CA: 2,
  CO: 2,
  TX: 2,
  OR: 3,
  WA: 3,
  ID: 3,
  MT: 3,
  WY: 3,
  OK: 3,
  KS: 3,
  NE: 3,
  SD: 3,
  ND: 3,
  MO: 4,
  AR: 4,
  LA: 4,
  MS: 4,
  AL: 4,
  TN: 4,
  KY: 4,
  IL: 4,
  IA: 4,
  MN: 4,
  WI: 4,
  MI: 4,
  IN: 4,
  OH: 4,
  GA: 5,
  FL: 5,
  SC: 5,
  NC: 5,
  VA: 5,
  WV: 5,
  PA: 5,
  NY: 5,
  NJ: 5,
  CT: 5,
  MA: 5,
  RI: 5,
  NH: 5,
  VT: 5,
  ME: 5,
  MD: 5,
  DE: 5,
  DC: 5,
  HI: 5,
  AK: 5,
};

const BAND_BASE_USD: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 285,
  2: 365,
  3: 445,
  4: 525,
  5: 625,
};

export type QuoteDestination = {
  country?: string;
  state?: string;
  postcode: string;
  city?: string;
  address_1?: string;
  residential?: boolean;
};

export type QuoteCartItem = {
  sku: string;
  quantity: number;
  line_total?: number;
};

export type QuoteRequestBody = {
  currency?: string;
  destination: QuoteDestination;
  items: QuoteCartItem[];
};

export type ResolvedShipItem = {
  sku: string;
  canonicalSku: string;
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  freightClass: string;
  shipMode: "ltl" | "parcel" | "white_glove_only" | "not_shipped";
  usedFallbackDims: boolean;
  volumeIn3: number;
};

export type BuiltPallet = {
  index: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  contentWeightLb: number;
  tareLb: number;
  totalWeightLb: number;
  freightClass: string;
  skus: string[];
};

export type ShippingRateOption = {
  id: string;
  label: string;
  cost: number;
  taxable: boolean;
  rateSource: "fedex_ltl_live" | "fallback_zone_matrix" | "showroom_pickup";
  estimatedTransitDays: number | null;
  meta: Record<string, string | number | boolean | null>;
};

export type ShippingQuoteResult = {
  ok: true;
  quoteId: string;
  expiresAt: string;
  originZip: string;
  destination: {
    country: string;
    state: string;
    postcode: string;
    city: string;
    residential: boolean;
  };
  palletSummary: {
    palletCount: number;
    totalWeightLbs: number;
    pallets: BuiltPallet[];
    usedFallbackDims: boolean;
    parcelItemCount: number;
  };
  rates: ShippingRateOption[];
};

export type CatalogDimRow = {
  globalSku: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLb: number | null;
  shipMode: string | null;
  ltlClass: string | null;
  productName?: string | null;
};

export type QuoteCatalogDeps = {
  resolveAliases: (skus: string[]) => Promise<Map<string, string>>;
  loadDims: (canonicalSkus: string[]) => Promise<Map<string, CatalogDimRow>>;
  fedex?: FedExDeps;
  now?: () => number;
  originZip?: string;
  /** Force fallback (tests). */
  forceFallback?: boolean;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function parseNum(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = String(raw).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeShippingSecret(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").replace(/[\r\n]+/g, "");
}

export function resolveShippingQuoteSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return normalizeShippingSecret(
    env.WOO_SHIPPING_QUOTE_SECRET || env.WOOCOMMERCE_WEBHOOK_SECRET || "",
  );
}

/** Constant-time compare of shipping shared secrets. */
export function shippingSecretMatches(
  provided: string | null | undefined,
  expected: string,
): boolean {
  const a = normalizeShippingSecret(provided);
  const b = normalizeShippingSecret(expected);
  if (!a || !b) return false;
  try {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) {
      // Still run a compare to reduce length-leak timing; result discarded.
      timingSafeEqual(ab, Buffer.alloc(ab.length));
      return false;
    }
    return timingSafeEqual(ab, bb);
  } catch {
    return timingSafeEqualString(a, b);
  }
}

export async function authorizeShippingQuoteRequest(
  request: Request,
): Promise<{ ok: true; via: "shipping_secret" | "partner" | "embed" } | { ok: false }> {
  const expected = resolveShippingQuoteSecret();
  const headerSecret =
    request.headers.get("x-ccpatio-shipping-secret") ??
    request.headers.get("X-CCPatio-Shipping-Secret");
  if (expected && shippingSecretMatches(headerSecret, expected)) {
    return { ok: true, via: "shipping_secret" };
  }

  const url = new URL(request.url);
  const partnerToken =
    request.headers.get("x-ccpatio-partner-token") ??
    request.headers.get("X-CCPatio-Partner-Token") ??
    request.headers.get("x-primeview-partner-token") ??
    url.searchParams.get("token");
  const partner = authenticatePrimeviewHandoffToken(partnerToken);
  if (partner.ok) return { ok: true, via: "partner" };

  if (await authorizeEmbedRequest(request)) {
    return { ok: true, via: "embed" };
  }

  return { ok: false };
}

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Strip facing suffix for SOW/dim lookup fallback. */
export function baseSkuWithoutFacing(sku: string): string {
  return normalizeSku(sku).replace(/-(LS|RS)$/i, "");
}

export function inferFallbackCategory(sku: string, productName?: string | null): string {
  const s = normalizeSku(sku);
  const name = (productName ?? "").toLowerCase();
  if (/COVER|PILLOW|WEIGHT|CUSHION-ONLY|RTL-CVR|RTL-PIL/i.test(s) || /cover|pillow|weight/.test(name)) {
    return "parcel";
  }
  if (/HEATER|HEAT/i.test(s) || /heater/.test(name)) return "heater";
  if (/LAMP|LIGHT/i.test(s) || /lamp|lantern/.test(name)) return "lamp";
  if (/UMBRELLA|UMB/i.test(s) || /umbrella/.test(name)) return "umbrella";
  if (/LOUNGE|CHAISE|DAYBED/i.test(s) || /lounger|chaise|daybed/.test(name)) return "lounger";
  if (/TABLE|TBL|COFFEE|DINING|SIDE/i.test(s) || /table/.test(name)) return "table";
  if (/SOFA|CHAIR|SECTIONAL|OTTOMAN|BENCH|STOOL/i.test(s) || /sofa|chair|ottoman|bench/.test(name)) {
    return "seating";
  }
  return "default";
}

export function isParcelLike(item: Pick<ResolvedShipItem, "shipMode" | "weightLb" | "sku">): boolean {
  if (item.shipMode === "parcel" || item.shipMode === "not_shipped") return true;
  if (item.weightLb <= 15 && /COVER|PILLOW|WEIGHT|RTL-CVR|RTL-PIL/i.test(item.sku)) return true;
  return false;
}

export function parseQuoteRequest(body: unknown):
  | { ok: true; data: QuoteRequestBody }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object" };
  const rec = body as Record<string, unknown>;
  const dest = rec.destination;
  if (!dest || typeof dest !== "object") return { ok: false, error: "destination is required" };
  const d = dest as Record<string, unknown>;
  const postcode = String(d.postcode ?? "").trim();
  if (!postcode) return { ok: false, error: "destination.postcode is required" };
  const itemsRaw = rec.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return { ok: false, error: "items must be a non-empty array" };
  }
  const items: QuoteCartItem[] = [];
  for (const row of itemsRaw) {
    if (!row || typeof row !== "object") return { ok: false, error: "invalid item" };
    const r = row as Record<string, unknown>;
    const sku = String(r.sku ?? "").trim();
    const quantity = Number(r.quantity);
    if (!sku) return { ok: false, error: "each item requires sku" };
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `invalid quantity for ${sku}` };
    }
    items.push({
      sku,
      quantity,
      line_total: r.line_total != null ? Number(r.line_total) : undefined,
    });
  }
  return {
    ok: true,
    data: {
      currency: typeof rec.currency === "string" ? rec.currency : "USD",
      destination: {
        country: typeof d.country === "string" ? d.country : "US",
        state: typeof d.state === "string" ? d.state : undefined,
        postcode,
        city: typeof d.city === "string" ? d.city : undefined,
        address_1: typeof d.address_1 === "string" ? d.address_1 : undefined,
        residential: d.residential === false ? false : true,
      },
      items,
    },
  };
}

export async function defaultResolveAliases(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const s of skus) map.set(s, s);
  if (skus.length === 0) return map;
  try {
    const db = getDb();
    const rows = await db
      .select({
        alias: sku_aliases.alias_sku,
        canonical: sku_aliases.canonical_sku,
      })
      .from(sku_aliases)
      .where(inArray(sku_aliases.alias_sku, skus));
    for (const row of rows) {
      map.set(normalizeSku(row.alias), normalizeSku(row.canonical));
    }
  } catch {
    // Tests / missing DB: identity map is fine; dims loader may still resolve.
  }
  return map;
}

export async function defaultLoadDims(
  canonicalSkus: string[],
): Promise<Map<string, CatalogDimRow>> {
  const out = new Map<string, CatalogDimRow>();
  if (canonicalSkus.length === 0) return out;
  try {
    const db = getDb();
    const shipRows = await db
      .select({
        globalSku: catalog_ship_profiles.global_sku,
        lengthIn: catalog_ship_profiles.length_in,
        widthIn: catalog_ship_profiles.width_in,
        heightIn: catalog_ship_profiles.height_in,
        weightLb: catalog_ship_profiles.weight_lb,
        shipMode: catalog_ship_profiles.ship_mode,
        ltlClass: catalog_ship_profiles.ltl_class,
      })
      .from(catalog_ship_profiles)
      .where(inArray(catalog_ship_profiles.global_sku, canonicalSkus));

    for (const row of shipRows) {
      out.set(normalizeSku(row.globalSku), {
        globalSku: normalizeSku(row.globalSku),
        lengthIn: parseNum(row.lengthIn),
        widthIn: parseNum(row.widthIn),
        heightIn: parseNum(row.heightIn),
        weightLb: parseNum(row.weightLb),
        shipMode: row.shipMode,
        ltlClass: row.ltlClass,
      });
    }

    const missing = canonicalSkus.filter((s) => {
      const row = out.get(normalizeSku(s));
      return !row || row.lengthIn == null || row.widthIn == null || row.heightIn == null || row.weightLb == null;
    });

    if (missing.length > 0) {
      const hubRows = await db
        .select({
          globalSku: finished_goods_catalog.global_sku,
          length: finished_goods_catalog.length,
          depth: finished_goods_catalog.depth,
          height: finished_goods_catalog.height,
          weight: finished_goods_catalog.weight,
          description: finished_goods_catalog.description,
        })
        .from(finished_goods_catalog)
        .where(inArray(finished_goods_catalog.global_sku, missing));

      for (const row of hubRows) {
        const key = normalizeSku(row.globalSku);
        const prev = out.get(key);
        out.set(key, {
          globalSku: key,
          lengthIn: prev?.lengthIn ?? parseNum(row.length),
          widthIn: prev?.widthIn ?? parseNum(row.depth),
          heightIn: prev?.heightIn ?? parseNum(row.height),
          weightLb: prev?.weightLb ?? parseNum(row.weight),
          shipMode: prev?.shipMode ?? null,
          ltlClass: prev?.ltlClass ?? null,
          productName: row.description,
        });
      }

      // ecommerce_listings may carry display dims when catalog_ship_profiles is empty
      const stillMissing = missing.filter((s) => {
        const row = out.get(normalizeSku(s));
        return !row || row.lengthIn == null || row.weightLb == null;
      });
      if (stillMissing.length > 0) {
        const listingRows = await db
          .select({
            globalSku: ecommerce_listings.global_sku,
            wooSku: ecommerce_listings.woo_sku,
            productName: ecommerce_listings.product_name,
          })
          .from(ecommerce_listings)
          .where(
            or(
              inArray(ecommerce_listings.global_sku, stillMissing),
              inArray(ecommerce_listings.woo_sku, stillMissing),
            ),
          );
        for (const row of listingRows) {
          const key = normalizeSku(row.globalSku);
          if (!out.has(key)) {
            out.set(key, {
              globalSku: key,
              lengthIn: null,
              widthIn: null,
              heightIn: null,
              weightLb: null,
              shipMode: null,
              ltlClass: null,
              productName: row.productName,
            });
          } else {
            const prev = out.get(key)!;
            out.set(key, { ...prev, productName: prev.productName ?? row.productName });
          }
        }
      }
    }
  } catch {
    // Caller applies category fallbacks.
  }
  return out;
}

export function resolveCartItems(
  items: QuoteCartItem[],
  aliasMap: Map<string, string>,
  dimMap: Map<string, CatalogDimRow>,
): ResolvedShipItem[] {
  const resolved: ResolvedShipItem[] = [];
  for (const item of items) {
    const raw = normalizeSku(item.sku);
    const aliased = normalizeSku(aliasMap.get(raw) ?? aliasMap.get(item.sku) ?? raw);
    const base = baseSkuWithoutFacing(aliased);
    const dim =
      dimMap.get(aliased) ??
      dimMap.get(base) ??
      dimMap.get(raw) ??
      null;

    const category = inferFallbackCategory(aliased, dim?.productName);
    const fallback = FALLBACK_DIMS_BY_CATEGORY[category] ?? FALLBACK_DIMS_BY_CATEGORY.default!;

    const lengthIn = dim?.lengthIn ?? fallback.lengthIn;
    const widthIn = dim?.widthIn ?? fallback.widthIn;
    const heightIn = dim?.heightIn ?? fallback.heightIn;
    const weightLb = dim?.weightLb ?? fallback.weightLb;
    const usedFallbackDims =
      dim?.lengthIn == null ||
      dim?.widthIn == null ||
      dim?.heightIn == null ||
      dim?.weightLb == null;

    const shipModeRaw = (dim?.shipMode ?? "").toLowerCase();
    let shipMode: ResolvedShipItem["shipMode"] = "ltl";
    if (shipModeRaw === "parcel") shipMode = "parcel";
    else if (shipModeRaw === "white_glove_only") shipMode = "white_glove_only";
    else if (shipModeRaw === "not_shipped") shipMode = "not_shipped";
    else if (category === "parcel") shipMode = "parcel";

    const freightClass = dim?.ltlClass?.trim() || "175";
    const qty = Math.max(1, Math.floor(item.quantity));

    for (let i = 0; i < qty; i += 1) {
      resolved.push({
        sku: raw,
        canonicalSku: aliased,
        quantity: 1,
        lengthIn,
        widthIn,
        heightIn,
        weightLb,
        freightClass,
        shipMode,
        usedFallbackDims,
        volumeIn3: lengthIn * widthIn * heightIn,
      });
    }
  }
  return resolved;
}

/**
 * Bin-pack physical LTL units into 90×40×45 pallets. Parcel-like accessories
 * ride along on the last pallet (or a virtual parcel tote) without spawning
 * dedicated full pallets when alone.
 */
export function consolidatePallets(items: ResolvedShipItem[]): {
  pallets: BuiltPallet[];
  parcelItemCount: number;
  usedFallbackDims: boolean;
} {
  const ltl = items.filter((i) => !isParcelLike(i) && i.shipMode !== "not_shipped");
  const parcel = items.filter((i) => isParcelLike(i));
  const usedFallbackDims = items.some((i) => i.usedFallbackDims);

  const maxVol =
    LTL_PALLET_MAX_LENGTH_IN * LTL_PALLET_MAX_WIDTH_IN * LTL_PALLET_MAX_HEIGHT_IN;

  // Sort largest-first for a stable greedy pack.
  const sorted = [...ltl].sort((a, b) => b.volumeIn3 - a.volumeIn3);
  type Open = {
    usedVol: number;
    maxL: number;
    maxW: number;
    stackedH: number;
    contentWeight: number;
    bestClass: number;
    skus: string[];
  };
  const opens: Open[] = [];

  for (const unit of sorted) {
    const unitL = Math.min(unit.lengthIn, LTL_PALLET_MAX_LENGTH_IN);
    const unitW = Math.min(unit.widthIn, LTL_PALLET_MAX_WIDTH_IN);
    const unitH = Math.min(unit.heightIn, LTL_PALLET_MAX_HEIGHT_IN);
    const vol = unitL * unitW * unitH;
    let placed = false;
    for (const open of opens) {
      const nextH = open.stackedH + unitH;
      if (open.usedVol + vol <= maxVol && nextH <= LTL_PALLET_MAX_HEIGHT_IN) {
        open.usedVol += vol;
        open.stackedH = nextH;
        open.maxL = Math.max(open.maxL, unitL);
        open.maxW = Math.max(open.maxW, unitW);
        open.contentWeight += unit.weightLb;
        open.bestClass = Math.max(open.bestClass, Number(unit.freightClass) || 175);
        open.skus.push(unit.canonicalSku);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Oversized single unit still becomes its own pallet (clamped footprint).
      opens.push({
        usedVol: Math.min(vol, maxVol),
        maxL: unitL,
        maxW: unitW,
        stackedH: Math.min(unitH, LTL_PALLET_MAX_HEIGHT_IN),
        contentWeight: unit.weightLb,
        bestClass: Number(unit.freightClass) || 175,
        skus: [unit.canonicalSku],
      });
    }
  }

  // Parcel accessories: attach to last pallet or create a light consolidated tote.
  let parcelWeight = 0;
  const parcelSkus: string[] = [];
  for (const p of parcel) {
    parcelWeight += p.weightLb;
    parcelSkus.push(p.canonicalSku);
  }

  if (opens.length === 0 && (parcel.length > 0 || sorted.length === 0)) {
    // Empty cart should not happen (schema), but parcel-only carts get one light tote.
    opens.push({
      usedVol: 0,
      maxL: 24,
      maxW: 18,
      stackedH: 12,
      contentWeight: parcelWeight || 1,
      bestClass: 100,
      skus: parcelSkus.length ? parcelSkus : ["PARCEL"],
    });
  } else if (parcel.length > 0 && opens.length > 0) {
    const last = opens[opens.length - 1]!;
    last.contentWeight += parcelWeight;
    last.skus.push(...parcelSkus);
  }

  const pallets: BuiltPallet[] = opens.map((o, index) => {
    const tare = o.skus.every((s) => s === "PARCEL" || /COVER|PILLOW|WEIGHT/i.test(s))
      ? 5
      : LTL_PALLET_TARE_LB;
    return {
      index: index + 1,
      lengthIn: Math.min(Math.max(o.maxL, 1), LTL_PALLET_MAX_LENGTH_IN),
      widthIn: Math.min(Math.max(o.maxW, 1), LTL_PALLET_MAX_WIDTH_IN),
      heightIn: Math.min(Math.max(o.stackedH, 12), LTL_PALLET_MAX_HEIGHT_IN),
      contentWeightLb: round1(o.contentWeight),
      tareLb: tare,
      totalWeightLb: round1(o.contentWeight + tare),
      freightClass: String(o.bestClass),
      skus: o.skus,
    };
  });

  return { pallets, parcelItemCount: parcel.length, usedFallbackDims };
}

export function fallbackZoneBand(state: string | undefined): 1 | 2 | 3 | 4 | 5 {
  const st = (state ?? "").trim().toUpperCase();
  return STATE_BAND[st] ?? 4;
}

export function computeFallbackLtlRate(input: {
  state?: string;
  palletCount: number;
  totalWeightLbs: number;
}): { cost: number; estimatedTransitDays: number; band: 1 | 2 | 3 | 4 | 5 } {
  const band = fallbackZoneBand(input.state);
  const base = BAND_BASE_USD[band];
  const palletCount = Math.max(1, input.palletCount);
  const weightFactor = Math.max(0, input.totalWeightLbs - 150) * 0.18;
  const palletFactor = (palletCount - 1) * 145;
  const cost = round2(base + weightFactor + palletFactor);
  const estimatedTransitDays = band <= 2 ? 3 : band <= 3 ? 5 : band <= 4 ? 6 : 8;
  return { cost, estimatedTransitDays, band };
}

async function rateFedExOrFallback(input: {
  originZip: string;
  destZip: string;
  state?: string;
  residential: boolean;
  pallets: BuiltPallet[];
  deps: QuoteCatalogDeps;
}): Promise<{
  cost: number;
  estimatedTransitDays: number | null;
  rateSource: "fedex_ltl_live" | "fallback_zone_matrix";
}> {
  const totalWeightLbs = input.pallets.reduce((s, p) => s + p.totalWeightLb, 0);
  const fallback = () => {
    const f = computeFallbackLtlRate({
      state: input.state,
      palletCount: input.pallets.length,
      totalWeightLbs,
    });
    return {
      cost: f.cost,
      estimatedTransitDays: f.estimatedTransitDays,
      rateSource: "fallback_zone_matrix" as const,
    };
  };

  if (input.deps.forceFallback) return fallback();

  const env = input.deps.fedex?.env ?? process.env;
  if (!isFedExFreightConfigured(env)) return fallback();

  try {
    const quotePromise = getFedExFreightQuote(
      {
        originZip: input.originZip,
        destZip: input.destZip,
        items: input.pallets.map((p) => ({
          weightLb: p.totalWeightLb,
          lengthIn: p.lengthIn,
          widthIn: p.widthIn,
          heightIn: p.heightIn,
          freightClass: p.freightClass || "175",
        })),
      },
      input.deps.fedex,
    );

    const timed = await Promise.race([
      quotePromise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new FedExFreightError("TIMEOUT", "FedEx Freight rating timed out.")),
          FEDEX_QUOTE_TIMEOUT_MS,
        );
      }),
    ]);

    // Residential + Liftgate accessorials are included in the customer-facing label;
    // when FedEx sandbox omits them, apply a modest accessorial uplift so TaxJar sees
    // a realistic taxable shipping total (deterministic, documented).
    const accessorialUplift = input.residential !== false ? 95 : 45;
    return {
      cost: round2(timed.rate + accessorialUplift),
      estimatedTransitDays: timed.days,
      rateSource: "fedex_ltl_live",
    };
  } catch {
    return fallback();
  }
}

export function buildPickupRates(): ShippingRateOption[] {
  return [
    {
      id: RATE_ID_PICKUP_SCOTTSDALE,
      label: RATE_LABEL_PICKUP_SCOTTSDALE,
      cost: 0,
      taxable: false,
      rateSource: "showroom_pickup",
      estimatedTransitDays: 0,
      meta: { showroom: "scottsdale", address: "15037 N Scottsdale Rd" },
    },
    {
      id: RATE_ID_PICKUP_SOLANA,
      label: RATE_LABEL_PICKUP_SOLANA,
      cost: 0,
      taxable: false,
      rateSource: "showroom_pickup",
      estimatedTransitDays: 0,
      meta: { showroom: "solana_beach", address: "312 S. Cedros Ave" },
    },
  ];
}

export async function buildWooCheckoutQuote(
  request: QuoteRequestBody,
  deps: QuoteCatalogDeps = {
    resolveAliases: defaultResolveAliases,
    loadDims: defaultLoadDims,
  },
): Promise<ShippingQuoteResult> {
  const now = deps.now ?? Date.now;
  const originZip =
    deps.originZip ||
    process.env.CCPATIO_FREIGHT_ORIGIN_ZIP?.trim() ||
    CCPATIO_FREIGHT_ORIGIN_ZIP;

  const skus = request.items.map((i) => normalizeSku(i.sku));
  const aliasMap = await deps.resolveAliases(skus);
  const canonicals = [
    ...new Set(
      skus.map((s) => normalizeSku(aliasMap.get(s) ?? s)).flatMap((c) => [c, baseSkuWithoutFacing(c)]),
    ),
  ];
  const dimMap = await deps.loadDims(canonicals);
  const resolved = resolveCartItems(request.items, aliasMap, dimMap);
  const { pallets, parcelItemCount, usedFallbackDims } = consolidatePallets(resolved);
  const totalWeightLbs = round1(pallets.reduce((s, p) => s + p.totalWeightLb, 0));

  const destZip = request.destination.postcode.replace(/\D/g, "").slice(0, 5) || request.destination.postcode;
  const residential = request.destination.residential !== false;

  const fedex = await rateFedExOrFallback({
    originZip,
    destZip,
    state: request.destination.state,
    residential,
    pallets,
    deps,
  });

  const quoteId = `ccp-ship-${randomUUID()}`;
  const expiresAt = new Date(now() + QUOTE_TTL_MS).toISOString();

  const rates: ShippingRateOption[] = [
    {
      id: RATE_ID_FEDEX_LTL,
      label: RATE_LABEL_FEDEX_LTL,
      cost: fedex.cost,
      taxable: true,
      rateSource: fedex.rateSource,
      estimatedTransitDays: fedex.estimatedTransitDays,
      meta: {
        residential,
        liftgate: true,
        palletCount: pallets.length,
        totalWeightLbs,
      },
    },
    ...buildPickupRates(),
  ];

  return {
    ok: true,
    quoteId,
    expiresAt,
    originZip,
    destination: {
      country: (request.destination.country || "US").toUpperCase(),
      state: (request.destination.state || "").toUpperCase(),
      postcode: destZip,
      city: request.destination.city || "",
      residential,
    },
    palletSummary: {
      palletCount: pallets.length,
      totalWeightLbs,
      pallets,
      usedFallbackDims,
      parcelItemCount,
    },
    rates,
  };
}

/** Stable cache key helper (also used by WP plugin docs / tests). */
export function quoteRequestFingerprint(body: QuoteRequestBody): string {
  return createHash("md5")
    .update(
      JSON.stringify({
        destination: body.destination,
        items: body.items
          .map((i) => ({ sku: normalizeSku(i.sku), quantity: i.quantity }))
          .sort((a, b) => a.sku.localeCompare(b.sku)),
      }),
    )
    .digest("hex");
}
