/**
 * TaxJar → Hub → QBO penny-exact tax & shipping pass-through.
 *
 * TaxJar Professional runs ONLY inside WooCommerce checkout. Hub never
 * recalculates tax for QBO; it stages the exact Woo/TaxJar cart_tax +
 * shipping_tax (+ tax_lines) onto Invoice / SalesReceipt payloads with
 * GlobalTaxCalculation = NotApplicable.
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function moneyToNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = Number(raw.trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export type TaxJarTaxLine = {
  rate_code: string;
  label: string;
  rate_percent: number;
  tax_total: number;
  shipping_tax_total: number;
};

export type CcpatioShippingLineMeta = {
  method_id: string;
  method_title: string;
  total: number;
  total_tax: number;
  quote_id: string | null;
  pallet_count: number | null;
  total_weight_lbs: number | null;
  rate_source: string | null;
};

export type TaxJarOrderTelemetry = {
  total_tax: number;
  cart_tax: number;
  shipping_total: number;
  shipping_tax: number;
  discount_total: number;
  order_total: number;
  line_items_subtotal: number;
  tax_lines: TaxJarTaxLine[];
  shipping_lines: CcpatioShippingLineMeta[];
  exemption: {
    taxjar_exemption_type: string | null;
    is_vat_exempt: boolean;
    tax_exemption_type: string | null;
  };
};

function metaMap(
  meta: Array<{ key?: string; value?: unknown }> | undefined,
): Map<string, unknown> {
  const m = new Map<string, unknown>();
  if (!Array.isArray(meta)) return m;
  for (const row of meta) {
    if (row && typeof row.key === "string") m.set(row.key, row.value);
  }
  return m;
}

function metaString(map: Map<string, unknown>, key: string): string | null {
  const v = map.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function metaNumber(map: Map<string, unknown>, key: string): number | null {
  const v = map.get(key);
  if (v == null || v === "") return null;
  const n = moneyToNumber(v);
  return Number.isFinite(n) ? n : null;
}

export function extractTaxJarTelemetry(order: {
  total?: unknown;
  total_tax?: unknown;
  cart_tax?: unknown;
  shipping_total?: unknown;
  shipping_tax?: unknown;
  discount_total?: unknown;
  line_items?: Array<{
    subtotal?: unknown;
    total?: unknown;
  }>;
  tax_lines?: unknown[];
  shipping_lines?: unknown[];
  meta_data?: Array<{ key?: string; value?: unknown }>;
  customer?: { meta_data?: Array<{ key?: string; value?: unknown }> };
}): TaxJarOrderTelemetry {
  const taxLines: TaxJarTaxLine[] = [];
  if (Array.isArray(order.tax_lines)) {
    for (const row of order.tax_lines) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      taxLines.push({
        rate_code: String(r.rate_code ?? r.rate_id ?? ""),
        label: String(r.label ?? ""),
        rate_percent: moneyToNumber(r.rate_percent),
        tax_total: moneyToNumber(r.tax_total),
        shipping_tax_total: moneyToNumber(r.shipping_tax_total),
      });
    }
  }

  const shippingLines: CcpatioShippingLineMeta[] = [];
  if (Array.isArray(order.shipping_lines)) {
    for (const row of order.shipping_lines) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const mm = metaMap(r.meta_data as Array<{ key?: string; value?: unknown }> | undefined);
      shippingLines.push({
        method_id: String(r.method_id ?? ""),
        method_title: String(r.method_title ?? ""),
        total: moneyToNumber(r.total),
        total_tax: moneyToNumber(r.total_tax),
        quote_id: metaString(mm, "_ccpatio_quote_id"),
        pallet_count: metaNumber(mm, "_ccpatio_pallet_count"),
        total_weight_lbs: metaNumber(mm, "_ccpatio_total_weight_lbs"),
        rate_source: metaString(mm, "_ccpatio_rate_source"),
      });
    }
  }

  const orderMeta = metaMap(order.meta_data);
  const customerMeta = metaMap(order.customer?.meta_data);

  let lineItemsSubtotal = 0;
  if (Array.isArray(order.line_items)) {
    for (const li of order.line_items) {
      const sub = moneyToNumber(li.subtotal ?? li.total);
      lineItemsSubtotal = round2(lineItemsSubtotal + sub);
    }
  }

  const totalTax = moneyToNumber(order.total_tax);
  const shippingTax = moneyToNumber(order.shipping_tax);
  // Prefer explicit cart_tax; else derive from total_tax - shipping_tax.
  const cartTaxRaw = order.cart_tax;
  const cartTax =
    cartTaxRaw != null && String(cartTaxRaw).trim() !== ""
      ? moneyToNumber(cartTaxRaw)
      : round2(Math.max(0, totalTax - shippingTax));

  return {
    total_tax: totalTax,
    cart_tax: cartTax,
    shipping_total: moneyToNumber(order.shipping_total),
    shipping_tax: shippingTax,
    discount_total: moneyToNumber(order.discount_total),
    order_total: moneyToNumber(order.total),
    line_items_subtotal: lineItemsSubtotal,
    tax_lines: taxLines,
    shipping_lines: shippingLines,
    exemption: {
      taxjar_exemption_type:
        metaString(orderMeta, "_taxjar_exemption_type") ??
        metaString(customerMeta, "_taxjar_exemption_type"),
      is_vat_exempt:
        String(metaString(orderMeta, "is_vat_exempt") ?? metaString(customerMeta, "is_vat_exempt") ?? "")
          .toLowerCase() === "yes" ||
        metaString(orderMeta, "is_vat_exempt") === "true",
      tax_exemption_type:
        metaString(orderMeta, "tax_exemption_type") ??
        metaString(customerMeta, "tax_exemption_type"),
    },
  };
}

/** Penny-exact Woo balance: items - discounts + shipping + tax === total. */
export function assertPennyExactOrderBalance(t: TaxJarOrderTelemetry): {
  ok: boolean;
  expectedTotal: number;
  actualTotal: number;
  delta: number;
} {
  const expectedTotal = round2(
    t.line_items_subtotal - t.discount_total + t.shipping_total + t.total_tax,
  );
  const actualTotal = round2(t.order_total);
  const delta = round2(expectedTotal - actualTotal);
  return { ok: Math.abs(delta) < 0.015, expectedTotal, actualTotal, delta };
}

/**
 * QBO Invoice / SalesReceipt tax block — Never let QBO recalculate.
 * Uses TaxJar's exact cart_tax + shipping_tax as a single TxnTaxDetail total.
 */
export function buildQboTaxPassthroughPayload(telemetry: TaxJarOrderTelemetry): {
  GlobalTaxCalculation: "NotApplicable";
  TxnTaxDetail: {
    TotalTax: number;
    TaxLine?: Array<{
      Amount: number;
      DetailType: "TaxLineDetail";
      TaxLineDetail: {
        PercentBased: false;
        NetAmountTaxable: number;
        TaxInclusiveAmount?: number;
        TaxPercent?: number;
      };
    }>;
  };
  ShippingLine?: {
    Amount: number;
    Description: string;
    DetailType: "SalesItemLineDetail";
  };
  CcPatioTaxTelemetry: {
    cart_tax: number;
    shipping_tax: number;
    total_tax: number;
    shipping_total: number;
    tax_lines: TaxJarTaxLine[];
    shipping_lines: CcpatioShippingLineMeta[];
    balance: ReturnType<typeof assertPennyExactOrderBalance>;
  };
} {
  const balance = assertPennyExactOrderBalance(telemetry);
  const shippingTitle =
    telemetry.shipping_lines[0]?.method_title || "Shipping";

  return {
    GlobalTaxCalculation: "NotApplicable",
    TxnTaxDetail: {
      TotalTax: round2(telemetry.total_tax),
      TaxLine:
        telemetry.total_tax > 0
          ? [
              {
                Amount: round2(telemetry.cart_tax),
                DetailType: "TaxLineDetail",
                TaxLineDetail: {
                  PercentBased: false,
                  NetAmountTaxable: round2(
                    telemetry.line_items_subtotal - telemetry.discount_total,
                  ),
                },
              },
              ...(telemetry.shipping_tax > 0
                ? [
                    {
                      Amount: round2(telemetry.shipping_tax),
                      DetailType: "TaxLineDetail" as const,
                      TaxLineDetail: {
                        PercentBased: false as const,
                        NetAmountTaxable: round2(telemetry.shipping_total),
                      },
                    },
                  ]
                : []),
            ]
          : undefined,
    },
    ShippingLine:
      telemetry.shipping_total > 0
        ? {
            Amount: round2(telemetry.shipping_total),
            Description: shippingTitle,
            DetailType: "SalesItemLineDetail",
          }
        : undefined,
    CcPatioTaxTelemetry: {
      cart_tax: telemetry.cart_tax,
      shipping_tax: telemetry.shipping_tax,
      total_tax: telemetry.total_tax,
      shipping_total: telemetry.shipping_total,
      tax_lines: telemetry.tax_lines,
      shipping_lines: telemetry.shipping_lines,
      balance,
    },
  };
}

export type TaxExemptionCustomer = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  tax_exemption_type?: string | null;
  tax_exempt_regions?: string[] | string | null;
  resale_certificate?: string | null;
  ghl_contact_id?: string | null;
};

/**
 * Formats approved GHL/Hub trade resale exemptions for Woo user meta_data
 * and TaxJar /v2/customers (Hub sync helper — does not call TaxJar itself).
 */
export function buildTaxExemptionSyncPayload(customer: TaxExemptionCustomer): {
  woo_meta_data: Array<{ key: string; value: string }>;
  taxjar_customer: {
    customer_id: string;
    exemption_type: string;
    name: string;
    exempt_regions: Array<{ country: string; state: string }>;
  };
} {
  const exemptionType = (customer.tax_exemption_type || "other").trim() || "other";
  const regionsRaw = customer.tax_exempt_regions;
  const regionCodes: string[] = Array.isArray(regionsRaw)
    ? regionsRaw.map((r) => String(r).trim().toUpperCase()).filter(Boolean)
    : typeof regionsRaw === "string"
      ? regionsRaw
          .split(/[,|;]/)
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean)
      : ["AZ", "CA"];

  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim()
    || customer.company
    || customer.email
    || "Trade Customer";

  const customerId =
    customer.ghl_contact_id?.trim() ||
    customer.email?.trim().toLowerCase() ||
    `exempt-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`;

  return {
    woo_meta_data: [
      { key: "tax_exemption_type", value: exemptionType },
      { key: "tax_exempt_regions", value: regionCodes.join(",") },
      { key: "_taxjar_exemption_type", value: exemptionType },
      ...(customer.resale_certificate
        ? [{ key: "resale_certificate", value: customer.resale_certificate }]
        : []),
    ],
    taxjar_customer: {
      customer_id: customerId,
      exemption_type: exemptionType,
      name,
      exempt_regions: regionCodes.map((state) => ({ country: "US", state })),
    },
  };
}
