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

/**
 * Build a surgical parent PUT body + variation batch payload.
 * Never includes protected meta or gallery images unless hero ownership is claimed.
 */
export function buildSurgicalWooPayload(
  parent: HubParentInput,
  units: WooStoreUnits,
): {
  product: Record<string, unknown>;
  variationBatch: { create: Record<string, unknown>[]; update: Record<string, unknown>[]; delete: number[] };
  dryRunPreview: Record<string, unknown>;
} {
  const meta_data: Array<{ key: string; value: string }> = [
    { key: "_w3d_enabled", value: "" },
  ];
  if (parent.fabricSwatchesJson) {
    meta_data.push({ key: "acf_fabric_swatches_json", value: parent.fabricSwatchesJson });
  }
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
    short_description: parent.shortDescription ?? "",
    description: parent.description ?? "",
    attributes,
    meta_data,
  };
  if (parent.slug) product.slug = parent.slug;

  // Gallery preservation: only set images when Hub explicitly owns a new hero URL.
  if (parent.heroImageUrl && !parent.preserveExistingImages) {
    product.images = [{ src: parent.heroImageUrl }];
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

    const body: Record<string, unknown> = {
      sku: variation.sku,
      regular_price: moneyString(variation.regularPrice),
      sale_price: moneyString(variation.salePrice),
      weight,
      dimensions: dims,
      shipping_class: shippingClassFromWeightLb(variation.weightLb),
      attributes: attrs,
      meta_data: [
        ...(variation.katanaSku
          ? [{ key: "_ccpatio_katana_sku", value: variation.katanaSku }]
          : []),
        ...(variation.makeOrResale
          ? [{ key: "_ccpatio_origin", value: variation.makeOrResale }]
          : []),
      ],
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

export async function fetchWooStoreUnits(): Promise<WooStoreUnits> {
  const { data } = await wooV3Fetch<unknown>("/settings/products");
  return parseWooStoreUnits(data);
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
 */
export async function pushParentToWoo(
  parent: HubParentInput,
  options?: { dryRun?: boolean },
): Promise<{
  dryRun: boolean;
  productId: string | null;
  preview: Record<string, unknown>;
}> {
  const units = await fetchWooStoreUnits().catch(
    (): WooStoreUnits => ({ weightUnit: "lb", dimensionUnit: "in" }),
  );
  const built = buildSurgicalWooPayload(parent, units);
  if (options?.dryRun || !resolveWooConnection().configured) {
    return {
      dryRun: true,
      productId: parent.wooProductId ?? null,
      preview: built.dryRunPreview,
    };
  }

  let productId = parent.wooProductId ? Number(parent.wooProductId) : NaN;
  if (!Number.isFinite(productId) || productId <= 0) {
    const list = await wooV3Fetch<Array<{ id?: number; sku?: string }>>(
      `/products?sku=${encodeURIComponent(parent.sku)}&per_page=1`,
    );
    const existing = Array.isArray(list.data) ? list.data[0] : null;
    productId = existing && typeof existing.id === "number" ? existing.id : NaN;
  }

  if (Number.isFinite(productId) && productId > 0) {
    await wooV3Fetch(`/products/${productId}`, { method: "PUT", body: built.product });
    if (built.variationBatch.create.length > 0) {
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
