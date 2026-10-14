/**
 * Shared in-memory fakes for the Phase B1 Woo tests. No database, no network.
 * (The real-PostgreSQL proof of the resolver SQL is `woo-sku-resolver-pglite.test.ts`.)
 */
import type { IncomingWebhookRow, WebhookLogInput } from "@/server/webhooks/incoming-log";
import type { WooOrderWebhook } from "@/server/woocommerce/ingress.schema";
import type { SkuRecord, WooResolveDeps } from "@/server/woocommerce/sku-resolver";

export const BASE_SKU = "FIN-TST-CHA-001";
export const FAB_SKU = "FAB-SUN-123";
export const PWD_SKU = "PWD-BLK";
export const FRAME_ALUM = "MET-ALUM";
export const FRAME_STEEL = "MET-STEEL";

export const VARIANT = {
  base: 100,
  fab: 201,
  pwd: 301,
  alum: 401,
  steel: 402,
  genericFab: 901,
  genericPwd: 902,
} as const;

export function skuRecord(sku: string, overrides: Partial<SkuRecord> = {}): SkuRecord {
  return {
    sku,
    itemType: "raw_material",
    isActive: true,
    syncToWoo: false,
    katanaVariantId: null,
    attributes: {},
    hasCatalogRow: false,
    hasActiveListing: false,
    ...overrides,
  };
}

export function defaultRecords(): Map<string, SkuRecord> {
  const web = { web_sellable: true };
  return new Map<string, SkuRecord>(
    [
      skuRecord(BASE_SKU, {
        itemType: "finished_good",
        syncToWoo: true,
        hasCatalogRow: true,
        katanaVariantId: VARIANT.base,
      }),
      skuRecord(FAB_SKU, { attributes: web, katanaVariantId: VARIANT.fab }),
      skuRecord(PWD_SKU, { attributes: web, katanaVariantId: VARIANT.pwd }),
      skuRecord(FRAME_ALUM, { attributes: web, katanaVariantId: VARIANT.alum }),
      skuRecord(FRAME_STEEL, { attributes: web, katanaVariantId: VARIANT.steel }),
      skuRecord("RM-FAB-GENERIC", { katanaVariantId: VARIANT.genericFab }),
      skuRecord("RM-PWD-GENERIC", { katanaVariantId: VARIANT.genericPwd }),
    ].map((r) => [r.sku, r]),
  );
}

export const DEFAULT_RECIPE = [
  "SA-TST-CHA-FRAME",
  "SA-TST-CHA-CUSH",
  "RM-FAB-GENERIC",
  "RM-PWD-GENERIC",
  "RM-TUBE-1",
];

export function makeHub(opts: {
  records?: Map<string, SkuRecord>;
  recipes?: Map<string, string[]>;
} = {}): WooResolveDeps & {
  records: Map<string, SkuRecord>;
  recipes: Map<string, string[]>;
  lookups: string[][];
} {
  const records = opts.records ?? defaultRecords();
  const recipes = opts.recipes ?? new Map([[BASE_SKU, DEFAULT_RECIPE]]);
  const lookups: string[][] = [];
  return {
    records,
    recipes,
    lookups,
    async lookupSkus(skus) {
      lookups.push([...skus]);
      const out = new Map<string, SkuRecord>();
      for (const sku of skus) {
        const rec = records.get(sku);
        if (rec) out.set(sku, rec);
      }
      return out;
    },
    async recipeSkus(sku) {
      return recipes.get(sku) ?? [];
    },
  };
}

/** In-memory `incoming_webhooks`: same insert-once / get / set semantics as the real module. */
export function makeIncomingLogFake() {
  const rows = new Map<string, IncomingWebhookRow & { eventName: string }>();
  return {
    rows,
    insertOnce: async (input: WebhookLogInput): Promise<"inserted" | "duplicate"> => {
      if (rows.has(input.idempotencyKey)) return "duplicate";
      rows.set(input.idempotencyKey, {
        status: input.status,
        payload: input.payload,
        eventName: input.eventName,
      });
      return "inserted";
    },
    get: async (key: string): Promise<IncomingWebhookRow | null> => {
      const row = rows.get(key);
      return row ? { status: row.status, payload: row.payload } : null;
    },
    set: async (
      key: string,
      status: "received" | "processed" | "failed",
      payload: unknown,
    ): Promise<void> => {
      const row = rows.get(key);
      if (!row) throw new Error(`no row ${key}`);
      rows.set(key, { ...row, status, payload });
    },
    updateStatus: async (key: string, status: "processed" | "failed"): Promise<void> => {
      const row = rows.get(key);
      if (row) rows.set(key, { ...row, status });
    },
  };
}

type Meta = Array<{ key: string; value: unknown }>;

export function defaultLineMeta(): Meta {
  return [
    { key: "fabric", value: FAB_SKU },
    { key: "powder_coat", value: PWD_SKU },
    { key: "frame", value: FRAME_ALUM },
  ];
}

export function wooLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Chair",
    product_id: 7,
    quantity: 2,
    sku: BASE_SKU,
    meta_data: defaultLineMeta(),
    ...overrides,
  };
}

export function wooOrder(overrides: Record<string, unknown> = {}): WooOrderWebhook {
  return {
    id: 1042,
    number: "1042",
    status: "processing",
    currency: "USD",
    date_paid: "2026-10-13T12:00:00",
    order_key: "wc_order_secret_key",
    billing: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
    },
    shipping: {
      first_name: "Ada",
      last_name: "Lovelace",
      address_1: "1 Main St",
      city: "Austin",
      state: "TX",
      postcode: "78701",
      country: "US",
    },
    meta_data: [],
    line_items: [wooLine()],
    ...overrides,
  } as unknown as WooOrderWebhook;
}
