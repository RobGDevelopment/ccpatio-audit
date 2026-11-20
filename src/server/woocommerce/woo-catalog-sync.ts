/**
 * Surgical WooCommerce REST API v3 catalog sync for the GHL E-Commerce portal.
 * Updates only commerce-owned fields — never Brizy / Astra / RankMath / gallery
 * images unless the Hub hero URL explicitly changed.
 */
import { WooCommerceApiError } from "@/lib/woocommerce-catalog";

export const LB_TO_KG = 0.45359237;
export const IN_TO_CM = 2.54;
export const PARCEL_MAX_LB = 50;

/** The 16 ACF add-on customer price meta keys (PrimeView / Phase 1). */
export const ACF_ADDON_PRICE_KEYS = [
  "ironwood_price",
  "dekton_sidearm_price",
  "arms_price",
  "arms_8_thick_textile-wrapped_price",
  "casters_price",
  "fly_tables_price",
  "fly_table_13_x_30_price",
  "fly_table_12_x_36_welded_on_back_price",
  "fly_table_12_x_48_welded_on_back_price",
  "umbrella_holder_price",
  "umbrella_cover_price",
  "coated_led_weight_price",
  "pillow_for_loungers_w_pocket_price",
  "base_w_wheels_price",
  "base_price",
  "wheels_price",
] as const;

export type AcfAddonPriceKey = (typeof ACF_ADDON_PRICE_KEYS)[number];

export type WooStoreUnits = {
  weightUnit: "lb" | "kg" | "oz" | "g";
  dimensionUnit: "in" | "cm" | "m" | "mm" | "yd";
};

export type WooSyncStatus = "synced" | "dirty" | "error" | "never";

export type HubVariationInput = {
  sku: string;
  regularPrice: string | number | null;
  salePrice?: string | number | null;
  weightLb: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  facing?: "Left-Side Facing" | "Right-Side Facing" | null;
  sizeLabel?: string | null;
  katanaSku?: string | null;
  makeOrResale?: "Make" | "Resale";
  /** Variation-level .glb override (size / -LS/-RS geometry). Inherited from parent when null. */
  model3dGlbUrl?: string | null;
  model3dUsdzUrl?: string | null;
};

export type HubParentInput = {
  wooProductId?: string | null;
  sku: string;
  slug?: string | null;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  status: "publish" | "draft";
  heroImageUrl?: string | null;
  /** Existing Woo gallery — preserved unless heroImageUrl is set and ownership claimed. */
  preserveExistingImages?: boolean;
  fabricSwatchesJson?: string | null;
  powderSwatchesJson?: string | null;
  dektonSwatchesJson?: string | null;
  /** Parent-level native WebGL model URLs. Never sent in images[]. */
  model3dGlbUrl?: string | null;
  model3dUsdzUrl?: string | null;
  addonPrices?: Partial<Record<AcfAddonPriceKey, string | number | null>>;
  optionBadges?: {
    fabrics24?: boolean;
    powders6?: boolean;
    steelAlu?: boolean;
    lrFacing?: boolean;
  };
  variations: HubVariationInput[];
  /** Meta keys already on the Woo product that we must never overwrite. */
  existingMeta?: Array<{ key: string; value: unknown }>;
  existingImages?: Array<{ id?: number; src?: string }>;
};

/** Non-empty string only — empty/null must be omitted so PUT never wipes staged WP 3D URLs. */
export function nonEmptyUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve effective 3D URL for a variation: variation override wins, else parent.
 * Returns null when both are empty (caller must omit the meta key).
 */
export function resolveInherited3dUrl(
  variationUrl: string | null | undefined,
  parentUrl: string | null | undefined,
): string | null {
  return nonEmptyUrl(variationUrl) ?? nonEmptyUrl(parentUrl);
}

export function shippingClassFromWeightLb(weightLb: number | null | undefined): "parcel" | "freight-ltl" {
  const w = Number(weightLb ?? 0);
  return Number.isFinite(w) && w >= PARCEL_MAX_LB ? "freight-ltl" : "parcel";
}

export function convertWeightForStore(weightLb: number, units: WooStoreUnits): string {
  if (!Number.isFinite(weightLb)) return "";
  if (units.weightUnit === "kg") return (Math.round(weightLb * LB_TO_KG * 100) / 100).toFixed(2);
  if (units.weightUnit === "oz") return (Math.round(weightLb * 16 * 100) / 100).toFixed(2);
  if (units.weightUnit === "g") return String(Math.round(weightLb * LB_TO_KG * 1000));
  return (Math.round(weightLb * 100) / 100).toFixed(2);
}

export function convertDimensionForStore(inches: number, units: WooStoreUnits): string {
  if (!Number.isFinite(inches)) return "";
  if (units.dimensionUnit === "cm") return (Math.round(inches * IN_TO_CM * 100) / 100).toFixed(2);
  if (units.dimensionUnit === "m") return (Math.round(inches * IN_TO_CM) / 100).toFixed(3);
  if (units.dimensionUnit === "mm") return String(Math.round(inches * IN_TO_CM * 10));
  if (units.dimensionUnit === "yd") return (Math.round((inches / 36) * 1000) / 1000).toFixed(3);
  return (Math.round(inches * 100) / 100).toFixed(2);
}

export function parseWooStoreUnits(settings: unknown): WooStoreUnits {
  const rows = Array.isArray(settings) ? settings : [];
  let weightUnit: WooStoreUnits["weightUnit"] = "lb";
  let dimensionUnit: WooStoreUnits["dimensionUnit"] = "in";
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: string; value?: string };
    if (rec.id === "woocommerce_weight_unit" && typeof rec.value === "string") {
      const v = rec.value.toLowerCase();
      if (v === "kg" || v === "g" || v === "oz" || v === "lbs" || v === "lb") {
        weightUnit = v === "lbs" ? "lb" : (v as WooStoreUnits["weightUnit"]);
      }
    }
    if (rec.id === "woocommerce_dimension_unit" && typeof rec.value === "string") {
      const v = rec.value.toLowerCase();
      if (v === "cm" || v === "m" || v === "mm" || v === "in" || v === "yd") {
        dimensionUnit = v as WooStoreUnits["dimensionUnit"];
      }
    }
  }
  return { weightUnit, dimensionUnit };
}

const PROTECTED_META_PREFIXES = [
  "_brizy",
  "brizy",
  "astra-",
  "_astra",
  "rank_math",
  "_yoast",
  "elementor",
];

export function isProtectedMetaKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PROTECTED_META_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p));
}

function moneyString(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(String(value).replace(/[^0-9.-]+/g, ""));
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

export type BuildSurgicalWooPayloadOptions = {
  /**
   * When false (default), omit description/short_description so Hub price/variation
   * pushes never clobber PrimeView Brizy page-builder markup or SEO copy.
   * Set true only when creating a brand-new product or an explicit copy push.
   */
  includeCopy?: boolean;
};

/**
 * Build a surgical parent PUT body + variation batch payload.
 * Never includes protected meta or gallery images unless hero ownership is claimed.
 */
export function buildSurgicalWooPayload(
  parent: HubParentInput,
  units: WooStoreUnits,
  options: BuildSurgicalWooPayloadOptions = {},
): {
  product: Record<string, unknown>;
  variationBatch: { create: Record<string, unknown>[]; update: Record<string, unknown>[]; delete: number[] };
  dryRunPreview: Record<string, unknown>;
} {
  const includeCopy = options.includeCopy === true;
  const meta_data: Array<{ key: string; value: string }> = [
    { key: "_w3d_enabled", value: "" },
  ];
  if (parent.fabricSwatchesJson) {
    meta_data.push({ key: "acf_fabric_swatches_json", value: parent.fabricSwatchesJson });
  }
  if (parent.powderSwatchesJson) {
    meta_data.push({ key: "acf_powder_swatches_json", value: parent.powderSwatchesJson });
  }
  if (parent.dektonSwatchesJson) {
    meta_data.push({ key: "acf_dekton_swatches_json", value: parent.dektonSwatchesJson });
  }
  // Native .glb/.usdz — meta_data ONLY, never images[]. Omit when null/empty.
  const parentGlb = nonEmptyUrl(parent.model3dGlbUrl);
  const parentUsdz = nonEmptyUrl(parent.model3dUsdzUrl);
  if (parentGlb) meta_data.push({ key: "acf_3d_model_glb_url", value: parentGlb });
  if (parentUsdz) meta_data.push({ key: "acf_3d_model_usdz_url", value: parentUsdz });

  for (const key of ACF_ADDON_PRICE_KEYS) {
    const raw = parent.addonPrices?.[key];
    if (raw == null || raw === "") continue;
    meta_data.push({ key, value: moneyString(raw) });
  }

  // Preserve non-owned meta by omission — we never send protected keys.
  for (const existing of parent.existingMeta ?? []) {
    if (typeof existing.key !== "string") continue;
    if (isProtectedMetaKey(existing.key)) continue;
  }

  const attributes: Array<Record<string, unknown>> = [
    {
      name: "Select Size",
      visible: true,
      variation: true,
      options: [
        ...new Set(
          parent.variations
            .map((v) => v.sizeLabel?.trim())
            .filter((v): v is string => Boolean(v)),
        ),
      ],
    },
  ];
  const facings = [
    ...new Set(
      parent.variations
        .map((v) => v.facing)
        .filter((v): v is NonNullable<HubVariationInput["facing"]> => Boolean(v)),
    ),
  ];
  if (facings.length > 0 || parent.optionBadges?.lrFacing) {
    attributes.push({
      name: "Select Facing",
      visible: true,
      variation: true,
      options: facings.length > 0 ? facings : ["Left-Side Facing", "Right-Side Facing"],
    });
  }

  const product: Record<string, unknown> = {
    name: parent.name,
    sku: parent.sku,
    status: parent.status,
    type: "variable",
    attributes,
    meta_data,
  };
  if (includeCopy) {
    product.short_description = parent.shortDescription ?? "";
    product.description = parent.description ?? "";
  }
  if (parent.slug) product.slug = parent.slug;

  // Gallery preservation: only set images when Hub explicitly owns a new hero URL.
  // NEVER put .glb / .usdz into images[] — Woo REST rejects non-images with 400.
  if (parent.heroImageUrl && !parent.preserveExistingImages) {
    const hero = nonEmptyUrl(parent.heroImageUrl);
    if (hero && !/\.(glb|gltf|usdz)(\?|$)/i.test(hero)) {
      product.images = [{ src: hero }];
    }
  }
  // Otherwise omit `images` entirely so Woo keeps Brizy/PrimeView gallery.

  const create: Record<string, unknown>[] = [];
  const update: Record<string, unknown>[] = [];
  for (const variation of parent.variations) {
    const weight =
      variation.weightLb != null ? convertWeightForStore(variation.weightLb, units) : "";
    const dims = {
      length:
        variation.lengthIn != null ? convertDimensionForStore(variation.lengthIn, units) : "",
      width:
        variation.widthIn != null ? convertDimensionForStore(variation.widthIn, units) : "",
      height:
        variation.heightIn != null ? convertDimensionForStore(variation.heightIn, units) : "",
    };
    const attrs: Array<{ name: string; option: string }> = [];
    if (variation.sizeLabel) attrs.push({ name: "Select Size", option: variation.sizeLabel });
    if (variation.facing) attrs.push({ name: "Select Facing", option: variation.facing });

    const varMeta: Array<{ key: string; value: string }> = [
      ...(variation.katanaSku
        ? [{ key: "_ccpatio_katana_sku", value: variation.katanaSku }]
        : []),
      ...(variation.makeOrResale
        ? [{ key: "_ccpatio_origin", value: variation.makeOrResale }]
        : []),
    ];
    const glb = resolveInherited3dUrl(variation.model3dGlbUrl, parent.model3dGlbUrl);
    const usdz = resolveInherited3dUrl(variation.model3dUsdzUrl, parent.model3dUsdzUrl);
    if (glb) varMeta.push({ key: "acf_3d_model_glb_url", value: glb });
    if (usdz) varMeta.push({ key: "acf_3d_model_usdz_url", value: usdz });

    const body: Record<string, unknown> = {
      sku: variation.sku,
      regular_price: moneyString(variation.regularPrice),
      sale_price: moneyString(variation.salePrice),
      weight,
      dimensions: dims,
      shipping_class: shippingClassFromWeightLb(variation.weightLb),
      attributes: attrs,
      meta_data: varMeta,
    };
    create.push(body);
  }

  const dryRunPreview = {
    productId: parent.wooProductId ?? null,
    product,
    variationBatch: { create, update, delete: [] as number[] },
    units,
    protectedMetaOmitted: (parent.existingMeta ?? [])
      .filter((m) => typeof m.key === "string" && isProtectedMetaKey(m.key))
      .map((m) => m.key),
    imagesOmitted: !(parent.heroImageUrl && !parent.preserveExistingImages),
  };

  return {
    product,
    variationBatch: { create, update, delete: [] },
    dryRunPreview,
  };
}

export function resolveWooConnection():
  | { configured: true; host: string; baseUrl: string; authHeader: string }
  | { configured: false; host: null; reason: string } {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim().replace(/\/$/, "") ?? "";
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim() ?? "";
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim() ?? "";
  if (!baseUrl || !key || !secret) {
    return {
      configured: false,
      host: null,
      reason: "REST Keys Pending — CSV & Preview Ready",
    };
  }
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // keep raw
  }
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return {
    configured: true,
    host,
    baseUrl,
    authHeader: `Basic ${token}`,
  };
}

export async function wooV3Fetch<T = unknown>(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T; status: number }> {
  const conn = resolveWooConnection();
  if (!conn.configured) {
    throw new WooCommerceApiError(conn.reason, 0);
  }
  const url = `${conn.baseUrl}/wp-json/wc/v3${pathname}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: conn.authHeader,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { message: text };
    }
  }
  if (!response.ok) {
    const message =
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : `WooCommerce HTTP ${response.status}`;
    throw new WooCommerceApiError(message, response.status);
  }
  return { data: parsed as T, status: response.status };
}

/** Per-invocation memo so bulk sync never re-fetches /settings/products N times. */
let storeUnitsMemo: Promise<WooStoreUnits> | null = null;

export function resetWooStoreUnitsMemo(): void {
  storeUnitsMemo = null;
}

export async function fetchWooStoreUnits(): Promise<WooStoreUnits> {
  if (!storeUnitsMemo) {
    storeUnitsMemo = wooV3Fetch<unknown>("/settings/products")
      .then(({ data }) => parseWooStoreUnits(data))
      .catch((err) => {
        storeUnitsMemo = null;
        throw err;
      });
  }
  return storeUnitsMemo;
}

export async function testWooConnection(): Promise<
  | { ok: true; host: string }
  | { ok: false; reason: string }
> {
  const conn = resolveWooConnection();
  if (!conn.configured) return { ok: false, reason: conn.reason };
  try {
    await wooV3Fetch("/system_status?_fields=environment");
    return { ok: true, host: conn.host };
  } catch (error: unknown) {
    // Fallback: settings endpoint is enough to prove keys work.
    try {
      await fetchWooStoreUnits();
      return { ok: true, host: conn.host };
    } catch {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Woo connection failed",
      };
    }
  }
}

export function deriveWooSyncStatus(input: {
  wooProductId: string | null | undefined;
  hubUpdatedAt?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}): WooSyncStatus {
  if (input.lastError) return "error";
  if (!input.wooProductId) return "never";
  if (
    input.hubUpdatedAt &&
    input.lastSyncedAt &&
    new Date(input.hubUpdatedAt).getTime() > new Date(input.lastSyncedAt).getTime()
  ) {
    return "dirty";
  }
  if (input.wooProductId && !input.lastSyncedAt) return "dirty";
  return "synced";
}

/**
 * Upsert a variable product surgically. Matches by woo_product_id, else SKU.
 * Existing products: omit description/short_description unless includeCopy=true.
 * New products (POST): always include copy so Brizy has a starting point.
 */
export async function pushParentToWoo(
  parent: HubParentInput,
  options?: { dryRun?: boolean; includeCopy?: boolean; units?: WooStoreUnits },
): Promise<{
  dryRun: boolean;
  productId: string | null;
  preview: Record<string, unknown>;
}> {
  const units =
    options?.units ??
    (await fetchWooStoreUnits().catch(
      (): WooStoreUnits => ({ weightUnit: "lb", dimensionUnit: "in" }),
    ));

  let productId = parent.wooProductId ? Number(parent.wooProductId) : NaN;
  if (!Number.isFinite(productId) || productId <= 0) {
    if (!options?.dryRun && resolveWooConnection().configured) {
      const list = await wooV3Fetch<Array<{ id?: number; sku?: string }>>(
        `/products?sku=${encodeURIComponent(parent.sku)}&per_page=1`,
      );
      const existing = Array.isArray(list.data) ? list.data[0] : null;
      productId = existing && typeof existing.id === "number" ? existing.id : NaN;
    }
  }

  const isCreate = !(Number.isFinite(productId) && productId > 0);
  const includeCopy = options?.includeCopy === true || isCreate;
  const built = buildSurgicalWooPayload(parent, units, { includeCopy });

  if (options?.dryRun || !resolveWooConnection().configured) {
    return {
      dryRun: true,
      productId: parent.wooProductId ?? null,
      preview: built.dryRunPreview,
    };
  }

  if (!isCreate) {
    // Single PUT parent + single variations/batch per parent (no 3N serial timeout).
    await wooV3Fetch(`/products/${productId}`, { method: "PUT", body: built.product });
    if (
      built.variationBatch.create.length > 0 ||
      built.variationBatch.update.length > 0
    ) {
      await wooV3Fetch(`/products/${productId}/variations/batch`, {
        method: "POST",
        body: built.variationBatch,
      });
    }
    return {
      dryRun: false,
      productId: String(productId),
      preview: built.dryRunPreview,
    };
  }

  const created = await wooV3Fetch<{ id?: number }>("/products", {
    method: "POST",
    body: built.product,
  });
  const id = created.data?.id;
  if (id == null) throw new WooCommerceApiError("Woo product create returned no id", created.status);
  if (built.variationBatch.create.length > 0) {
    await wooV3Fetch(`/products/${id}/variations/batch`, {
      method: "POST",
      body: built.variationBatch,
    });
  }
  return { dryRun: false, productId: String(id), preview: built.dryRunPreview };
}

/** Bounded-concurrency helper for bulk parent sync (default 4). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
