/**
 * WooCommerce order-webhook ingress schema (V8).
 *
 * Single source of truth: docs/blueprints/GLOBAL_SKU_DICTIONARY.md
 * Compiled literals:     middleware/src/generated/global-e2e-skus.ts
 *
 * Re-generate SKUs with: python generate_sku_dictionary.py
 *
 * WooCommerce_Data_Schema.md is still EMPTY. This schema follows the
 * WooCommerce REST Order v3 webhook body (order.created / order.updated)
 * plus the material meta keys we will require once Woo attributes are
 * remapped onto Global E2E SKUs. Live catalog today uses pa_size /
 * pa_frame-type with marketing strings — those will fail closed here
 * until WOO-H1 lands.
 *
 * Performance: SKU membership is a Set.has O(1) check, not z.enum(657).
 * The generated tuple stays in the module graph; it is not parsed from
 * Markdown on the request path.
 */

import { z, type RefinementCtx } from "zod";
import {
  GLOBAL_E2E_SKU_SET,
  type GlobalE2ESku,
} from "../../generated/global-e2e-skus";

export type { GlobalE2ESku };

// ---------------------------------------------------------------------------
// SKU membership (O(1))
// ---------------------------------------------------------------------------

const SKU_REQUIRED = "SKU is required. Blank SKU is a hard fail (WOO-H1).";
const SKU_UNMAPPED =
  "Value is not in GLOBAL_SKU_DICTIONARY. Misspelled, unmapped, or factory name used instead of a Global E2E SKU.";

export function isGlobalE2eSku(value: string): value is GlobalE2ESku {
  return GLOBAL_E2E_SKU_SET.has(value);
}

export const globalE2eSkuSchema = z
  .string()
  .trim()
  .min(1, SKU_REQUIRED)
  .refine((value): value is GlobalE2ESku => isGlobalE2eSku(value), {
    message: SKU_UNMAPPED,
  });

function skuPrefix(sku: string): string {
  const dash = sku.indexOf("-");
  return dash === -1 ? sku : sku.slice(0, dash);
}

// ---------------------------------------------------------------------------
// Material meta keys that MUST resolve to a dictionary SKU when present
// ---------------------------------------------------------------------------

export type MaterialKind =
  | "fabric"
  | "stone"
  | "shade"
  | "frame"
  | "powder"
  | "furniture"
  | "firepit";

type MaterialRule = {
  kind: MaterialKind;
  /** When set, the SKU must start with this prefix (FAB-, STN-, …). */
  requiredPrefix: string | null;
};

const MATERIAL_RULES: Record<string, MaterialRule> = {
  cushion_fabric: { kind: "fabric", requiredPrefix: "FAB" },
  fabric: { kind: "fabric", requiredPrefix: "FAB" },
  "cushion-fabric": { kind: "fabric", requiredPrefix: "FAB" },
  stone: { kind: "stone", requiredPrefix: "STN" },
  dekton: { kind: "stone", requiredPrefix: "STN" },
  shade: { kind: "shade", requiredPrefix: "SHD" },
  umbrella: { kind: "shade", requiredPrefix: "SHD" },
  scolaro: { kind: "shade", requiredPrefix: "SHD" },
  // Locked prefixes: frame → MET-*, powder_coat → PWD-* (Purchasing Database Item Catalog).
  frame: { kind: "frame", requiredPrefix: "MET" },
  "frame-type": { kind: "frame", requiredPrefix: "MET" },
  frame_type: { kind: "frame", requiredPrefix: "MET" },
  powder: { kind: "powder", requiredPrefix: "PWD" },
  powder_coat: { kind: "powder", requiredPrefix: "PWD" },
  "powder-coat": { kind: "powder", requiredPrefix: "PWD" },
  furniture: { kind: "furniture", requiredPrefix: "FUR" },
  tenjam: { kind: "furniture", requiredPrefix: "FUR" },
  finished_good: { kind: "furniture", requiredPrefix: "FIN" },
  "finished-good": { kind: "furniture", requiredPrefix: "FIN" },
  firepit: { kind: "firepit", requiredPrefix: "FRP" },
};

/** Order / line meta keys that are configuration, not SKUs (do not enum-check). */
const PASSTHROUGH_META_KEYS = new Set([
  "size",
  "pa_size",
  "attribute_pa_size",
]);

function normalizeMetaKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^attribute_/, "")
    .replace(/^pa_/, "")
    .replace(/^_/, "")
    .replace(/\s+/g, "_");
}

function materialRuleForKey(rawKey: string): MaterialRule | null {
  const normalized = normalizeMetaKey(rawKey);
  if (PASSTHROUGH_META_KEYS.has(normalized) || PASSTHROUGH_META_KEYS.has(rawKey.trim().toLowerCase())) {
    return null;
  }
  return MATERIAL_RULES[normalized] ?? null;
}

function stringifyMetaValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function addSkuIssue(
  ctx: RefinementCtx,
  path: (string | number)[],
  message: string,
  received: unknown,
): void {
  ctx.addIssue({
    code: "custom",
    path,
    message: `${message} Received: ${JSON.stringify(received)}`,
  });
}

function validateMaterialValue(
  ctx: RefinementCtx,
  path: (string | number)[],
  rule: MaterialRule,
  rawValue: unknown,
): void {
  const value = stringifyMetaValue(rawValue);
  if (!value) {
    addSkuIssue(ctx, path, `${rule.kind} meta is empty. ${SKU_REQUIRED}`, rawValue);
    return;
  }
  if (!isGlobalE2eSku(value)) {
    addSkuIssue(ctx, path, `${rule.kind} ${SKU_UNMAPPED}`, value);
    return;
  }
  if (rule.requiredPrefix && skuPrefix(value) !== rule.requiredPrefix) {
    addSkuIssue(
      ctx,
      path,
      `${rule.kind} must be a ${rule.requiredPrefix}-* Global E2E SKU.`,
      value,
    );
  }
}

function validateMetaArray(
  ctx: RefinementCtx,
  meta: WooMetaDatum[],
  pathPrefix: (string | number)[],
): void {
  meta.forEach((entry, index) => {
    const rule = materialRuleForKey(entry.key);
    if (!rule) return;
    validateMaterialValue(ctx, [...pathPrefix, index, "value"], rule, entry.value);
  });
}

// ---------------------------------------------------------------------------
// WooCommerce REST Order v3 shapes
// ---------------------------------------------------------------------------

const numericId = z.number().int().nonnegative();

const moneyString = z.union([z.string(), z.number()]).transform(String);

export const wooAddressSchema = z.looseObject({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export const wooMetaDatumSchema = z.looseObject({
  id: numericId.optional(),
  key: z.string().min(1),
  value: z.unknown(),
  display_key: z.string().optional(),
  display_value: z.string().optional(),
});

export type WooMetaDatum = z.infer<typeof wooMetaDatumSchema>;

export const wooLineItemSchema = z
  .looseObject({
    id: numericId.optional(),
    name: z.string().min(1, "Line item name is required"),
    product_id: numericId,
    variation_id: numericId.optional(),
    quantity: z.number().positive("Line item quantity must be > 0"),
    sku: globalE2eSkuSchema,
    tax_class: z.string().optional(),
    subtotal: moneyString.optional(),
    subtotal_tax: moneyString.optional(),
    total: moneyString.optional(),
    total_tax: moneyString.optional(),
    price: z.number().optional(),
    meta_data: z.array(wooMetaDatumSchema).default([]),
  })
  .superRefine((item, ctx) => {
    validateMetaArray(ctx, item.meta_data, ["meta_data"]);
  });

export type WooLineItem = z.infer<typeof wooLineItemSchema>;

const wooOrderStatusSchema = z.enum([
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "checkout-draft",
]);

/**
 * Incoming WooCommerce Order webhook payload.
 * Extra REST fields pass through (z.looseObject) so plugin meta does not 400
 * the ingest — only SKU / material fields are fail-closed.
 */
export const wooOrderWebhookSchema = z
  .looseObject({
    id: numericId,
    parent_id: numericId.optional(),
    number: z.union([z.string(), z.number()]).transform(String).optional(),
    order_key: z.string().optional(),
    created_via: z.string().optional(),
    version: z.string().optional(),
    status: wooOrderStatusSchema.or(z.string()),
    currency: z.string().min(1).default("USD"),
    date_created: z.string().optional(),
    date_modified: z.string().optional(),
    date_paid: z.string().nullable().optional(),
    discount_total: moneyString.optional(),
    shipping_total: moneyString.optional(),
    total: moneyString.optional(),
    total_tax: moneyString.optional(),
    customer_id: numericId.optional(),
    customer_note: z.string().optional(),
    billing: wooAddressSchema.optional(),
    shipping: wooAddressSchema.optional(),
    payment_method: z.string().optional(),
    payment_method_title: z.string().optional(),
    transaction_id: z.string().optional(),
    meta_data: z.array(wooMetaDatumSchema).default([]),
    line_items: z
      .array(wooLineItemSchema)
      .min(1, "Order must contain at least one line item"),
    shipping_lines: z.array(z.unknown()).optional(),
    fee_lines: z.array(z.unknown()).optional(),
    coupon_lines: z.array(z.unknown()).optional(),
    tax_lines: z.array(z.unknown()).optional(),
    refunds: z.array(z.unknown()).optional(),
  })
  .superRefine((order, ctx) => {
    validateMetaArray(ctx, order.meta_data, ["meta_data"]);
  });

export type WooOrderWebhook = z.infer<typeof wooOrderWebhookSchema>;

// ---------------------------------------------------------------------------
// Parse helper — webhook route should call this, never schema.parse()
// ---------------------------------------------------------------------------

export type SkuIngressIssue = {
  path: string;
  message: string;
};

export type WooOrderParseResult =
  | { ok: true; data: WooOrderWebhook }
  | { ok: false; issues: SkuIngressIssue[] };

export function parseWooOrderWebhook(payload: unknown): WooOrderParseResult {
  const result = wooOrderWebhookSchema.safeParse(payload);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const issues: SkuIngressIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
  return { ok: false, issues };
}

/**
 * Compact body for GHL notes / Slack when validation fails.
 * The HTTP handler should persist the raw payload to quarantine BEFORE alerting
 * so the order is never dropped on the floor.
 */
export function formatQuarantineAlert(input: {
  orderId: unknown;
  issues: SkuIngressIssue[];
}): string {
  const lines = [
    `WooCommerce order ${String(input.orderId ?? "UNKNOWN")} quarantined — SKU validation failed.`,
    "Katana was not updated. Fix the SKU(s) and resubmit.",
    "",
    ...input.issues.map((issue) => `• ${issue.path}: ${issue.message}`),
  ];
  return lines.join("\n");
}
