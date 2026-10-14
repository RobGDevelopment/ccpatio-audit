/**
 * WooCommerce order-webhook ingress schema (Phase B1).
 *
 * STRUCTURAL validation only. This module has no SKU authority: whether a SKU exists, is a
 * finished good, is approved for web, or is a sellable finish is decided against the live hub
 * database by `sku-resolver.ts`. (The old static SKU dictionary file was deleted in
 * Phase B1.) Finish extraction lives in `line-specs.ts` / `finish-keys.ts`.
 *
 * The shape follows the WooCommerce REST Order v3 webhook body (order.created / order.updated).
 * Extra REST fields pass through (z.looseObject) so plugin meta never 400s the ingest.
 */

import { z } from "zod";

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

export const wooLineItemSchema = z.looseObject({
  id: numericId.optional(),
  name: z.string().min(1, "Line item name is required"),
  product_id: numericId,
  variation_id: numericId.optional(),
  quantity: z.number().positive("Line item quantity must be > 0"),
  sku: z.string().trim().min(1, "SKU is required. Blank SKU is a hard fail (WOO-H1)."),
  tax_class: z.string().optional(),
  subtotal: moneyString.optional(),
  subtotal_tax: moneyString.optional(),
  total: moneyString.optional(),
  total_tax: moneyString.optional(),
  price: z.number().optional(),
  meta_data: z.array(wooMetaDatumSchema).default([]),
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

/** Incoming WooCommerce Order webhook payload. */
export const wooOrderWebhookSchema = z.looseObject({
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
 * Compact body for the Oh-Crap alert when validation fails.
 * The HTTP handler persists the raw payload to quarantine BEFORE alerting so the order is never
 * dropped on the floor.
 */
export function formatQuarantineAlert(input: {
  orderId: unknown;
  issues: SkuIngressIssue[];
}): string {
  const lines = [
    `WooCommerce order ${String(input.orderId ?? "UNKNOWN")} quarantined: validation failed.`,
    "Katana was not updated. Fix the SKU(s) or finishes, then replay from /admin/quarantine.",
    "",
    ...input.issues.map((issue) => `• ${issue.path}: ${issue.message}`),
  ];
  return lines.join("\n");
}
