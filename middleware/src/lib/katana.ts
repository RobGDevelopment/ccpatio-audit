/**
 * Katana MRP outbound sync — materials, finished goods, BOM/recipes, sales orders.
 *
 * Auth: KATANA_PERSONAL_ACCESS_TOKEN (preferred) or legacy KATANA_API_KEY.
 * Materials → POST /materials (type "material")
 * Products  → POST /products  (type "product", is_material: false in ERP terms)
 * BOM       → POST /recipes   (keep_current_rows: false replaces existing lines)
 * Ops       → POST /product_operation_rows (minutes stored locally → seconds)
 * Orders    → POST /sales_orders
 * Recipe/ops sync respects ORDER_PIPELINE_MODE (live only for mutations)
 */

import { asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  item_operations,
  product_bom,
  raw_materials_catalog,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";
import {
  canMutateKatanaOrders,
  getOrderPipelineMode,
  pipelineModeLabel,
} from "@/server/pipeline/mode";
import type { WooOrderWebhook } from "@/server/woocommerce/ingress.schema";

const KATANA_API_BASE = "https://api.katanamrp.com/v1";
const MAX_RATE_LIMIT_RETRIES = 3;

export class KatanaApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly rateLimitReset?: number;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: unknown;
      rateLimitReset?: number;
    },
  ) {
    super(message);
    this.name = "KatanaApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.rateLimitReset = options.rateLimitReset;
  }
}

export type KatanaVariantRecord = {
  id: number;
  sku: string;
  type: "product" | "material" | string;
  product_id: number | null;
  material_id: number | null;
  purchase_price: number | null;
  sales_price: number | null;
};

export type KatanaSyncResult =
  | {
      ok: true;
      action: "created" | "updated" | "unchanged";
      sku: string;
      variantId: number;
      materialId?: number | null;
      productId?: number | null;
      message: string;
    }
  | { ok: false; error: string };

export type KatanaBomSyncResult =
  | {
      ok: true;
      finishedGoodSku: string;
      productVariantId: number;
      recipeRows: number;
      operationRows: number;
      nodesSynced: number;
      dryRun: boolean;
      message: string;
    }
  | { ok: false; error: string };

export type KatanaSalesOrderAddress = {
  entityType: "billing" | "shipping";
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
};

export type KatanaSalesOrderCustomer = {
  name: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  currency?: string | null;
  referenceId?: string | null;
};

export type KatanaSalesOrderRowInput = {
  /** Global E2E SKU — resolved to Katana variant_id at POST time. */
  sku: string;
  quantity: number;
  pricePerUnit: number;
};

export type KatanaSalesOrderPayload = {
  orderNo: string;
  customer: KatanaSalesOrderCustomer;
  salesOrderRows: KatanaSalesOrderRowInput[];
  currency?: string;
  additionalInfo?: string;
  customerRef?: string;
  ecommerceOrderType?: string;
  ecommerceStoreName?: string;
  ecommerceOrderId?: string;
  addresses?: KatanaSalesOrderAddress[];
  source?: "woocommerce" | "ghl";
  externalId?: string;
};

export type KatanaSalesOrderCreateResult = {
  salesOrderId: number;
  orderNo: string;
  customerId: number;
  rowCount: number;
  /** Katana sales_order_rows[].id — required for Make-to-Order POSTs. */
  salesOrderRowIds: number[];
};

export type KatanaMakeToOrderResult = {
  salesOrderRowId: number;
  manufacturingOrderId: number;
  orderNo: string | null;
};

type KatanaFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  retryCount?: number;
};


function resolveKatanaToken(): string {
  const token =
    process.env.KATANA_PERSONAL_ACCESS_TOKEN?.trim() ??
    process.env.KATANA_API_KEY?.trim();
  if (!token) {
    throw new KatanaApiError(
      "Missing KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY) in environment.",
      { status: 0 },
    );
  }
  return token;
}

function mapUomToKatana(uom: string): string {
  const normalized = uom.trim().toLowerCase();
  const table: Record<string, string> = {
    ea: "pcs",
    pc: "pcs",
    pcs: "pcs",
    in: "in",
    ft: "ft",
    yd: "yd",
    lbs: "lbs",
    lb: "lbs",
    sqft: "ft2",
    oz: "oz",
    gal: "gal",
  };
  return table[normalized] ?? normalized.slice(0, 7);
}

function parseJsonBody(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRateLimitReset(headers: Headers): number | undefined {
  const reset = headers.get("X-Ratelimit-Reset");
  if (!reset) {
    return undefined;
  }
  const parsed = Number(reset);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatKatanaError(status: number, body: unknown): string {
  const record = asRecord(body);
  const message =
    typeof record?.message === "string" ? record.message : `HTTP ${status}`;
  const details = record?.details;
  if (Array.isArray(details) && details.length > 0) {
    return `${message} — ${JSON.stringify(details.slice(0, 3))}`;
  }
  return message;
}

async function katanaFetch<T = unknown>(
  pathname: string,
  options: KatanaFetchOptions = {},
): Promise<{ data: T; status: number; headers: Headers }> {
  const token = resolveKatanaToken();
  const retryCount = options.retryCount ?? 0;
  const url = `${KATANA_API_BASE}${pathname}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 429) {
    const resetAt = readRateLimitReset(response.headers);
    const waitMs = resetAt
      ? Math.max(0, resetAt * 1000 - Date.now()) + 250
      : 1500 * (retryCount + 1);

    console.error("[katana] rate limit (429)", {
      path: pathname,
      retry: retryCount + 1,
      resetAt,
      waitMs,
    });

    if (retryCount < MAX_RATE_LIMIT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return katanaFetch<T>(pathname, {
        ...options,
        retryCount: retryCount + 1,
      });
    }

    throw new KatanaApiError("Katana API rate limit exceeded. Try again shortly.", {
      status: 429,
      code: "RATE_LIMIT",
      rateLimitReset: resetAt,
    });
  }

  const text = await response.text();
  const parsed = parseJsonBody(text);

  if (!response.ok) {
    if (response.status === 422) {
      console.error("[katana] payload rejected (422)", {
        path: pathname,
        body: parsed,
      });
    }

    throw new KatanaApiError(formatKatanaError(response.status, parsed), {
      status: response.status,
      code: asRecord(parsed)?.code as string | undefined,
      details: asRecord(parsed)?.details,
      rateLimitReset: readRateLimitReset(response.headers),
    });
  }

  return {
    data: parsed as T,
    status: response.status,
    headers: response.headers,
  };
}

function mapVariant(row: Record<string, unknown>): KatanaVariantRecord {
  return {
    id: Number(row.id),
    sku: String(row.sku ?? ""),
    type: String(row.type ?? ""),
    product_id:
      row.product_id == null ? null : Number(row.product_id),
    material_id:
      row.material_id == null ? null : Number(row.material_id),
    purchase_price:
      row.purchase_price == null ? null : Number(row.purchase_price),
    sales_price: row.sales_price == null ? null : Number(row.sales_price),
  };
}

export async function findVariantBySku(
  sku: string,
): Promise<KatanaVariantRecord | null> {
  const needle = sku.trim();
  if (!needle) {
    return null;
  }

  const query = new URLSearchParams();
  query.append("sku", needle);
  query.set("limit", "5");

  const { data } = await katanaFetch<{ data?: unknown[] }>(
    `/variants?${query.toString()}`,
  );

  const rows = Array.isArray(data.data) ? data.data : [];
  for (const item of rows) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const variant = mapVariant(record);
    if (variant.sku.toUpperCase() === needle.toUpperCase()) {
      return variant;
    }
  }

  return null;
}

function parseMoney(value: string | null | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

async function upsertMaterialInKatana(input: {
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPerUnit: string | null;
}): Promise<KatanaSyncResult> {
  const sku = input.sku.trim().toUpperCase();
  const existing = await findVariantBySku(sku);
  const purchasePrice = parseMoney(input.costPerUnit);
  const uom = mapUomToKatana(input.unitOfMeasure);

  if (existing?.material_id) {
    await katanaFetch(`/materials/${existing.material_id}`, {
      method: "PATCH",
      body: {
        name: input.name.trim() || sku,
        uom,
        category_name: input.category.trim() || undefined,
      },
    });

    if (purchasePrice !== null) {
      await katanaFetch(`/variants/${existing.id}`, {
        method: "PATCH",
        body: { purchase_price: purchasePrice },
      });
    }

    return {
      ok: true,
      action: "updated",
      sku,
      variantId: existing.id,
      materialId: existing.material_id,
      message: `Updated material ${sku} in Katana (variant #${existing.id}).`,
    };
  }

  if (existing?.product_id) {
    return {
      ok: false,
      error: `SKU ${sku} already exists in Katana as a product (variant #${existing.id}).`,
    };
  }

  const { data } = await katanaFetch<Record<string, unknown>>("/materials", {
    method: "POST",
    body: {
      name: input.name.trim() || sku,
      uom,
      category_name: input.category.trim() || undefined,
      is_sellable: false,
      variants: [
        {
          sku,
          ...(purchasePrice !== null ? { purchase_price: purchasePrice } : {}),
        },
      ],
    },
  });

  const materialId = Number(data.id);
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const variantRecord = asRecord(variants[0]);
  const variantId = variantRecord ? Number(variantRecord.id) : NaN;

  if (!Number.isFinite(materialId) || !Number.isFinite(variantId)) {
    return {
      ok: false,
      error: `Katana created material ${sku} but returned an incomplete response.`,
    };
  }

  return {
    ok: true,
    action: "created",
    sku,
    variantId,
    materialId,
    message: `Created material ${sku} in Katana (variant #${variantId}).`,
  };
}

async function upsertProductInKatana(input: {
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  salesPrice: string | null;
  description: string | null;
}): Promise<KatanaSyncResult> {
  const sku = input.sku.trim().toUpperCase();
  const existing = await findVariantBySku(sku);
  const salesPrice = parseMoney(input.salesPrice);
  const uom = mapUomToKatana(input.unitOfMeasure);

  if (existing?.product_id) {
    await katanaFetch(`/products/${existing.product_id}`, {
      method: "PATCH",
      body: {
        name: input.name.trim() || sku,
        uom,
        category_name: input.category.trim() || undefined,
        additional_info: input.description?.trim() || undefined,
        is_sellable: true,
        is_producible: true,
      },
    });

    if (salesPrice !== null) {
      await katanaFetch(`/variants/${existing.id}`, {
        method: "PATCH",
        body: { sales_price: salesPrice },
      });
    }

    return {
      ok: true,
      action: "updated",
      sku,
      variantId: existing.id,
      productId: existing.product_id,
      message: `Updated product ${sku} in Katana (variant #${existing.id}).`,
    };
  }

  if (existing?.material_id) {
    return {
      ok: false,
      error: `SKU ${sku} already exists in Katana as a material (variant #${existing.id}).`,
    };
  }

  const { data } = await katanaFetch<Record<string, unknown>>("/products", {
    method: "POST",
    body: {
      name: input.name.trim() || sku,
      uom,
      category_name: input.category.trim() || undefined,
      additional_info: input.description?.trim() || undefined,
      is_sellable: true,
      is_producible: true,
      is_purchasable: false,
      variants: [
        {
          sku,
          ...(salesPrice !== null ? { sales_price: salesPrice } : {}),
        },
      ],
    },
  });

  const productId = Number(data.id);
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const variantRecord = asRecord(variants[0]);
  const variantId = variantRecord ? Number(variantRecord.id) : NaN;

  if (!Number.isFinite(productId) || !Number.isFinite(variantId)) {
    return {
      ok: false,
      error: `Katana created product ${sku} but returned an incomplete response.`,
    };
  }

  return {
    ok: true,
    action: "created",
    sku,
    variantId,
    productId,
    message: `Created product ${sku} in Katana (variant #${variantId}).`,
  };
}

export async function syncRawMaterialToKatana(
  sku: string,
): Promise<KatanaSyncResult> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "SKU is required" };
  }

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(raw_materials_catalog)
      .where(eq(raw_materials_catalog.sku, needle))
      .limit(1);

    if (!row) {
      return { ok: false, error: `Raw material ${needle} not found in catalog.` };
    }

    return upsertMaterialInKatana({
      sku: row.sku,
      name: row.name,
      category: row.category,
      unitOfMeasure: row.unit_of_measure,
      costPerUnit: row.cost_per_unit,
    });
  } catch (error: unknown) {
    if (error instanceof KatanaApiError) {
      return { ok: false, error: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync raw material";
    return { ok: false, error: message };
  }
}

export async function syncFinishedGoodToKatana(
  sku: string,
): Promise<KatanaSyncResult> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "SKU is required" };
  }

  try {
    const db = getDb();
    const [row] = await db
      .select({
        mapping: sku_mappings,
        catalog: finished_goods_catalog,
      })
      .from(sku_mappings)
      .leftJoin(
        finished_goods_catalog,
        eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
      )
      .where(eq(sku_mappings.global_sku, needle))
      .limit(1);

    if (!row) {
      return { ok: false, error: `Finished good ${needle} not found in catalog.` };
    }

    const result = await upsertProductInKatana({
      sku: row.mapping.global_sku,
      name: row.mapping.original_name || row.mapping.global_sku,
      category: row.mapping.category,
      unitOfMeasure: "ea",
      salesPrice: row.catalog?.msrp ?? null,
      description: row.catalog?.description ?? null,
    });

    if (result.ok) {
      await db
        .update(sku_mappings)
        .set({ katana_variant_id: result.variantId })
        .where(eq(sku_mappings.global_sku, needle));
    }

    return result;
  } catch (error: unknown) {
    if (error instanceof KatanaApiError) {
      return { ok: false, error: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync finished good";
    return { ok: false, error: message };
  }
}

/**
 * Ensure a sku_mappings row has a Katana variant (product or material).
 * Sub-assemblies and finished goods sync as producible products.
 */
async function ensureKatanaVariantForSku(
  sku: string,
): Promise<KatanaSyncResult> {
  const needle = sku.trim().toUpperCase();
  const db = getDb();
  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (!mapping) {
    return { ok: false, error: `SKU ${needle} not found in sku_mappings.` };
  }

  if (mapping.katana_variant_id != null) {
    return {
      ok: true,
      action: "unchanged",
      sku: needle,
      variantId: mapping.katana_variant_id,
      materialId: mapping.katana_material_id,
      message: `Variant already mapped for ${needle}.`,
    };
  }

  if (mapping.item_type === "raw_material") {
    const materialSync = await syncRawMaterialToKatana(needle);
    if (materialSync.ok) return materialSync;

    // Fallback: sync from sku_mappings when not in raw_materials_catalog
    const result = await upsertMaterialInKatana({
      sku: mapping.global_sku,
      name: mapping.original_name || mapping.global_sku,
      category: mapping.category,
      unitOfMeasure: mapping.uom_purchase || mapping.uom_consume || "ea",
      costPerUnit: mapping.base_cost,
    });
    if (result.ok) {
      await db
        .update(sku_mappings)
        .set({
          katana_variant_id: result.variantId,
          katana_material_id: result.materialId ?? null,
        })
        .where(eq(sku_mappings.global_sku, needle));
    }
    return result;
  }

  // finished_good | sub_assembly | service → product
  return syncFinishedGoodToKatana(needle);
}

function minsToSeconds(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 60);
}

/**
 * Bottom-up recursive BOM + routing sync.
 * 1. Walk children; sync sub_assembly recipes/ops first
 * 2. POST /recipes with quantity * scrap_factor
 * 3. POST /product_operation_rows (minutes → seconds)
 * Gated by ORDER_PIPELINE_MODE === live (same as order mutations).
 */
export async function syncBOMToKatana(
  parentSku: string,
): Promise<KatanaBomSyncResult> {
  const needle = parentSku.trim().toUpperCase();
  if (!needle) {
    return { ok: false, error: "Parent SKU is required" };
  }

  const mode = getOrderPipelineMode();
  const allowMutate = canMutateKatanaOrders(mode);

  try {
    const db = getDb();
    const visited = new Set<string>();
    let totalRecipeRows = 0;
    let totalOperationRows = 0;
    let nodesSynced = 0;
    let rootVariantId = 0;

    async function syncNode(sku: string): Promise<{ ok: true } | { ok: false; error: string }> {
      if (visited.has(sku)) {
        return { ok: false, error: `BOM cycle detected at ${sku}` };
      }
      visited.add(sku);

      const [mapping] = await db
        .select()
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, sku))
        .limit(1);

      if (!mapping) {
        return { ok: false, error: `SKU ${sku} not found.` };
      }

      const bomLines = await db
        .select()
        .from(product_bom)
        .where(eq(product_bom.parent_sku, sku))
        .orderBy(asc(product_bom.child_sku));

      for (const line of bomLines) {
        const childSku = line.child_sku.trim().toUpperCase();
        const [childMapping] = await db
          .select({ item_type: sku_mappings.item_type })
          .from(sku_mappings)
          .where(eq(sku_mappings.global_sku, childSku))
          .limit(1);

        const childType: ItemType = childMapping?.item_type ?? "raw_material";
        if (childType === "sub_assembly") {
          const nested = await syncNode(childSku);
          if (!nested.ok) return nested;
        } else if (allowMutate) {
          const ensured = await ensureKatanaVariantForSku(childSku);
          if (!ensured.ok) {
            return {
              ok: false,
              error: `Component ${childSku}: ${ensured.error}`,
            };
          }
        }
      }

      // Ensure this node exists as a Katana product before recipe/ops push
      let productVariantId = mapping.katana_variant_id;
      if (allowMutate) {
        if (productVariantId == null) {
          const productSync = await ensureKatanaVariantForSku(sku);
          if (!productSync.ok) {
            return { ok: false, error: productSync.error };
          }
          productVariantId = productSync.variantId;
        }
      } else {
        productVariantId = productVariantId ?? 0;
      }

      if (sku === needle) {
        rootVariantId = productVariantId ?? 0;
      }

      const recipeRows: Array<{
        product_variant_id: number;
        ingredient_variant_id: number;
        quantity: number;
        notes?: string;
      }> = [];

      if (allowMutate && bomLines.length > 0 && productVariantId) {
        for (const line of bomLines) {
          const childSku = line.child_sku.trim().toUpperCase();
          let ingredientVariant = await findVariantBySku(childSku);
          if (!ingredientVariant) {
            const ensured = await ensureKatanaVariantForSku(childSku);
            if (!ensured.ok) {
              return {
                ok: false,
                error: `Component ${childSku}: ${ensured.error}`,
              };
            }
            ingredientVariant = await findVariantBySku(childSku);
          }
          if (!ingredientVariant) {
            return {
              ok: false,
              error: `Component ${childSku} could not be resolved in Katana.`,
            };
          }

          const qty = Number(line.quantity);
          const scrap = Number(line.scrap_factor ?? "1");
          if (!Number.isFinite(qty) || qty < 0) {
            return {
              ok: false,
              error: `Invalid quantity for component ${childSku}.`,
            };
          }
          const effectiveQty = qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1);

          recipeRows.push({
            product_variant_id: productVariantId,
            ingredient_variant_id: ingredientVariant.id,
            quantity: effectiveQty,
            notes: line.unit_of_measure,
          });
        }

        await katanaFetch("/recipes", {
          method: "POST",
          body: {
            keep_current_rows: false,
            rows: recipeRows,
          },
        });
      } else if (bomLines.length > 0) {
        // Dry-run: count planned recipe rows
        for (const _ of bomLines) {
          recipeRows.push({
            product_variant_id: 0,
            ingredient_variant_id: 0,
            quantity: 0,
          });
        }
      }

      totalRecipeRows += recipeRows.length;

      const ops = await db
        .select()
        .from(item_operations)
        .where(eq(item_operations.item_sku, sku))
        .orderBy(asc(item_operations.sequence));

      const operationPayload: Array<Record<string, unknown>> = [];
      for (const op of ops) {
        const setupSec = minsToSeconds(op.setup_time_mins);
        const runSec = minsToSeconds(op.run_time_mins);
        if (setupSec != null && setupSec > 0) {
          operationPayload.push({
            product_variant_id: productVariantId,
            operation_name: `${op.work_center} Setup`,
            resource_name: op.work_center,
            type: "setup",
            planned_time_parameter: setupSec,
          });
        }
        if (runSec != null && runSec > 0) {
          operationPayload.push({
            product_variant_id: productVariantId,
            operation_name: op.work_center,
            resource_name: op.work_center,
            type: "process",
            planned_time_parameter: runSec,
          });
        }
      }

      if (allowMutate && operationPayload.length > 0 && productVariantId) {
        // Katana public API: POST /product_operation_rows (product operations)
        await katanaFetch("/product_operation_rows", {
          method: "POST",
          body: {
            keep_current_rows: false,
            rows: operationPayload,
          },
        });
      }

      totalOperationRows += operationPayload.length;
      nodesSynced += 1;
      return { ok: true };
    }

    const result = await syncNode(needle);
    if (!result.ok) {
      return result;
    }

    if (totalRecipeRows === 0 && totalOperationRows === 0) {
      return {
        ok: false,
        error: `No BOM lines or operations defined for ${needle} (or its sub-assemblies).`,
      };
    }

    if (!allowMutate) {
      return {
        ok: true,
        finishedGoodSku: needle,
        productVariantId: rootVariantId,
        recipeRows: totalRecipeRows,
        operationRows: totalOperationRows,
        nodesSynced,
        dryRun: true,
        message: `[${pipelineModeLabel(mode)}] Dry-run: would sync ${nodesSynced} node(s), ${totalRecipeRows} recipe row(s), ${totalOperationRows} operation row(s) for ${needle}. Set ORDER_PIPELINE_MODE=live to push.`,
      };
    }

    return {
      ok: true,
      finishedGoodSku: needle,
      productVariantId: rootVariantId,
      recipeRows: totalRecipeRows,
      operationRows: totalOperationRows,
      nodesSynced,
      dryRun: false,
      message: `Synced ${nodesSynced} node(s): ${totalRecipeRows} recipe row(s), ${totalOperationRows} operation row(s) for ${needle}.`,
    };
  } catch (error: unknown) {
    if (error instanceof KatanaApiError) {
      return { ok: false, error: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync BOM to Katana";
    return { ok: false, error: message };
  }
}

/** Alias matching task naming. */
export const syncBomToKatana = syncBOMToKatana;

function parseUnitPrice(value: string | number | undefined | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function wooAddressToKatana(
  address:
    | {
        first_name?: string;
        last_name?: string;
        company?: string;
        phone?: string;
        address_1?: string;
        address_2?: string;
        city?: string;
        state?: string;
        postcode?: string;
        country?: string;
      }
    | undefined,
  entityType: "billing" | "shipping",
): KatanaSalesOrderAddress | null {
  if (!address) {
    return null;
  }

  const hasContent = [
    address.first_name,
    address.last_name,
    address.company,
    address.address_1,
    address.city,
    address.state,
    address.postcode,
    address.country,
  ].some((part) => Boolean(part?.trim()));

  if (!hasContent) {
    return null;
  }

  return {
    entityType,
    firstName: address.first_name ?? null,
    lastName: address.last_name ?? null,
    company: address.company ?? null,
    phone: address.phone ?? null,
    line1: address.address_1 ?? null,
    line2: address.address_2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    zip: address.postcode ?? null,
    country: address.country ?? null,
  };
}

export function mapWooOrderToKatanaSalesOrder(
  order: WooOrderWebhook,
): KatanaSalesOrderPayload {
  const billing = order.billing;
  const shipping = order.shipping ?? order.billing;
  const customerName =
    [billing?.first_name, billing?.last_name].filter(Boolean).join(" ").trim() ||
    billing?.company?.trim() ||
    "WooCommerce Customer";

  const addresses = [
    wooAddressToKatana(billing, "billing"),
    wooAddressToKatana(shipping, "shipping"),
  ].filter((row): row is KatanaSalesOrderAddress => row !== null);

  return {
    orderNo: order.number ?? `WOO-${order.id}`,
    source: "woocommerce",
    externalId: String(order.id),
    currency: order.currency ?? "USD",
    customer: {
      name: customerName,
      email: billing?.email ?? null,
      firstName: billing?.first_name ?? null,
      lastName: billing?.last_name ?? null,
      company: billing?.company ?? null,
      phone: billing?.phone ?? null,
      currency: order.currency ?? "USD",
      referenceId: order.customer_id ? `woo-customer-${order.customer_id}` : null,
    },
    salesOrderRows: order.line_items.map((item) => {
      const lineTotal = parseUnitPrice(item.total);
      const unitPrice =
        item.price != null && Number.isFinite(item.price)
          ? item.price
          : item.quantity > 0
            ? lineTotal / item.quantity
            : 0;

      return {
        sku: item.sku,
        quantity: item.quantity,
        pricePerUnit: unitPrice,
      };
    }),
    additionalInfo: `source=woocommerce | woo_order=${order.id}`,
    customerRef: order.order_key ?? String(order.id),
    ecommerceOrderType: "woocommerce",
    ecommerceOrderId: String(order.id),
    addresses,
  };
}

type GhlSalesOrderInput = {
  id: string;
  name?: string;
  status?: string;
  monetary_value?: string | number;
  contact?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  line_items?: Array<{
    sku: string;
    quantity: number;
    price_per_unit?: string | number;
    name?: string;
  }>;
};

export function isGhlWonOpportunity(status: string | undefined): boolean {
  if (!status?.trim()) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "won" ||
    normalized === "closed won" ||
    normalized === "closed_won" ||
    normalized.includes("won")
  );
}

export function mapGhlOpportunityToKatanaSalesOrder(
  opportunity: GhlSalesOrderInput,
): KatanaSalesOrderPayload | null {
  if (!isGhlWonOpportunity(opportunity.status)) {
    return null;
  }

  const lineItems = opportunity.line_items ?? [];
  if (lineItems.length === 0) {
    return null;
  }

  const contact = opportunity.contact;
  const customerName =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() ||
    contact?.company?.trim() ||
    opportunity.name?.trim() ||
    `GHL Opportunity ${opportunity.id}`;

  const contactAddress = contact
    ? {
        first_name: contact.first_name,
        last_name: contact.last_name,
        company: contact.company,
        phone: contact.phone,
        address_1: contact.address_1,
        address_2: contact.address_2,
        city: contact.city,
        state: contact.state,
        postcode: contact.postal_code,
        country: contact.country,
      }
    : undefined;

  const addresses = [
    wooAddressToKatana(contactAddress, "billing"),
    wooAddressToKatana(contactAddress, "shipping"),
  ].filter((row): row is KatanaSalesOrderAddress => row !== null);

  const fallbackUnitPrice =
    opportunity.monetary_value != null && lineItems.length === 1
      ? parseUnitPrice(opportunity.monetary_value) / lineItems[0]!.quantity
      : 0;

  return {
    orderNo: `GHL-${opportunity.id}`,
    source: "ghl",
    externalId: opportunity.id,
    currency: "USD",
    customer: {
      name: customerName,
      email: contact?.email ?? null,
      firstName: contact?.first_name ?? null,
      lastName: contact?.last_name ?? null,
      company: contact?.company ?? null,
      phone: contact?.phone ?? null,
      currency: "USD",
      referenceId: `ghl-opportunity-${opportunity.id}`,
    },
    salesOrderRows: lineItems.map((item) => ({
      sku: item.sku.trim().toUpperCase(),
      quantity: item.quantity,
      pricePerUnit:
        item.price_per_unit != null
          ? parseUnitPrice(item.price_per_unit)
          : fallbackUnitPrice,
    })),
    additionalInfo: `source=ghl | ghl_opportunity=${opportunity.id}`,
    customerRef: opportunity.id,
    ecommerceOrderType: "ghl",
    ecommerceOrderId: opportunity.id,
    addresses,
  };
}

async function resolveVariantIdForSku(sku: string): Promise<number> {
  const needle = sku.trim().toUpperCase();
  if (!needle) {
    throw new KatanaApiError("Sales order row SKU is required.", { status: 422 });
  }

  const db = getDb();
  const [mapping] = await db
    .select({ variantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (mapping?.variantId != null) {
    return mapping.variantId;
  }

  const variant = await findVariantBySku(needle);
  if (!variant) {
    throw new KatanaApiError(
      `No Katana variant found for SKU ${needle}. Sync the product dictionary first.`,
      { status: 422 },
    );
  }

  return variant.id;
}

function katanaAddressPayload(
  address: KatanaSalesOrderAddress,
): Record<string, unknown> {
  return {
    entity_type: address.entityType,
    first_name: address.firstName ?? undefined,
    last_name: address.lastName ?? undefined,
    company: address.company ?? undefined,
    phone: address.phone ?? undefined,
    line_1: address.line1 ?? undefined,
    line_2: address.line2 ?? undefined,
    city: address.city ?? undefined,
    state: address.state ?? undefined,
    zip: address.zip ?? undefined,
    country: address.country ?? undefined,
  };
}

async function resolveKatanaCustomerId(
  customer: KatanaSalesOrderCustomer,
  addresses: KatanaSalesOrderAddress[],
): Promise<number> {
  const email = customer.email?.trim();
  if (email) {
    const query = new URLSearchParams();
    query.set("email", email);
    query.set("limit", "1");
    const { data } = await katanaFetch<{ data?: unknown[] }>(
      `/customers?${query.toString()}`,
    );
    const existing = asRecord(Array.isArray(data.data) ? data.data[0] : null);
    if (existing?.id != null) {
      return Number(existing.id);
    }
  }

  const customerAddresses = addresses.map((address) => ({
    ...katanaAddressPayload(address),
    default: address.entityType === "billing",
  }));

  const { data } = await katanaFetch<{ id: number }>("/customers", {
    method: "POST",
    body: {
      name: customer.name,
      first_name: customer.firstName ?? undefined,
      last_name: customer.lastName ?? undefined,
      company: customer.company ?? undefined,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      currency: customer.currency ?? undefined,
      reference_id: customer.referenceId ?? undefined,
      ...(customerAddresses.length > 0 ? { addresses: customerAddresses } : {}),
    },
  });

  if (!Number.isFinite(data.id)) {
    throw new KatanaApiError(
      "Katana customer creation succeeded without an id.",
      { status: 500 },
    );
  }

  return data.id;
}

/**
 * Creates a Katana sales order from a normalized middleware payload.
 * Resolves global SKUs → variant_id and finds or creates the customer.
 */
export async function createKatanaSalesOrder(
  orderPayload: KatanaSalesOrderPayload,
): Promise<KatanaSalesOrderCreateResult> {
  if (!orderPayload.orderNo.trim()) {
    throw new KatanaApiError("Sales order number is required.", { status: 422 });
  }

  if (orderPayload.salesOrderRows.length === 0) {
    throw new KatanaApiError(
      "Sales order must contain at least one line item.",
      { status: 422 },
    );
  }

  const resolvedRows: Array<{
    variant_id: number;
    quantity: number;
    price_per_unit: number;
    attributes?: Array<{ key: string; value: string }>;
  }> = [];

  for (const row of orderPayload.salesOrderRows) {
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
      throw new KatanaApiError(
        `Invalid quantity for SKU ${row.sku}.`,
        { status: 422 },
      );
    }

    const variantId = await resolveVariantIdForSku(row.sku);
    resolvedRows.push({
      variant_id: variantId,
      quantity: row.quantity,
      price_per_unit: row.pricePerUnit,
      attributes: [{ key: "global_sku", value: row.sku.trim().toUpperCase() }],
    });
  }

  const customerId = await resolveKatanaCustomerId(
    orderPayload.customer,
    orderPayload.addresses ?? [],
  );

  const salesOrderBody: Record<string, unknown> = {
    order_no: orderPayload.orderNo,
    customer_id: customerId,
    sales_order_rows: resolvedRows,
    currency: orderPayload.currency ?? "USD",
    additional_info: orderPayload.additionalInfo,
    customer_ref: orderPayload.customerRef,
    ecommerce_order_type: orderPayload.ecommerceOrderType,
    ecommerce_store_name: orderPayload.ecommerceStoreName,
    ecommerce_order_id: orderPayload.ecommerceOrderId,
  };

  if (orderPayload.addresses && orderPayload.addresses.length > 0) {
    salesOrderBody.addresses = orderPayload.addresses.map(katanaAddressPayload);
  }

  const { data } = await katanaFetch<Record<string, unknown>>("/sales_orders", {
    method: "POST",
    body: salesOrderBody,
  });

  const salesOrderId = Number(data.id);
  if (!Number.isFinite(salesOrderId)) {
    throw new KatanaApiError(
      "Katana sales order creation succeeded without an id.",
      { status: 500 },
    );
  }

  let salesOrderRowIds = extractSalesOrderRowIds(data);
  if (salesOrderRowIds.length === 0) {
    const fetched = await katanaFetch<Record<string, unknown>>(
      `/sales_orders/${salesOrderId}`,
    );
    salesOrderRowIds = extractSalesOrderRowIds(fetched.data);
  }

  return {
    salesOrderId,
    orderNo: orderPayload.orderNo,
    customerId,
    rowCount: resolvedRows.length,
    salesOrderRowIds,
  };
}

function extractSalesOrderRowIds(data: Record<string, unknown>): number[] {
  const rows = data.sales_order_rows;
  if (!Array.isArray(rows)) {
    return [];
  }
  const ids: number[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const id = Number(record?.id);
    if (Number.isFinite(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Create Make-to-Order manufacturing orders for each sales order row.
 * POST /manufacturing_order_make_to_order { sales_order_row_id }
 */
export async function createMakeToOrderManufacturingOrders(
  salesOrderRowIds: number[],
  options?: { createSubassemblies?: boolean },
): Promise<KatanaMakeToOrderResult[]> {
  const results: KatanaMakeToOrderResult[] = [];

  for (const salesOrderRowId of salesOrderRowIds) {
    if (!Number.isFinite(salesOrderRowId) || salesOrderRowId <= 0) {
      throw new KatanaApiError(
        `Invalid sales_order_row_id for MTO: ${salesOrderRowId}`,
        { status: 422 },
      );
    }

    const { data } = await katanaFetch<Record<string, unknown>>(
      "/manufacturing_order_make_to_order",
      {
        method: "POST",
        body: {
          sales_order_row_id: salesOrderRowId,
          create_subassemblies: options?.createSubassemblies ?? false,
        },
      },
    );

    const manufacturingOrderId = Number(data.id);
    if (!Number.isFinite(manufacturingOrderId)) {
      throw new KatanaApiError(
        `MTO create succeeded without id for sales_order_row_id=${salesOrderRowId}`,
        { status: 500, details: data },
      );
    }

    results.push({
      salesOrderRowId,
      manufacturingOrderId,
      orderNo: typeof data.order_no === "string" ? data.order_no : null,
    });
  }

  return results;
}
