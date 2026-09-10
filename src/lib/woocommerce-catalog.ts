/**
 * WooCommerce catalog REST helper for MDM fan-out (not order webhooks).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4.
 */
import type { WooProductPayload } from "@/mappers/woocommerce";

export class WooCommerceApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WooCommerceApiError";
    this.status = status;
  }
}

function resolveWooConfig(): { baseUrl: string; authHeader: string } {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim().replace(/\/$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim();
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim();
  if (!baseUrl || !key || !secret) {
    throw new WooCommerceApiError(
      "Missing WOOCOMMERCE_URL / WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET",
      0,
    );
  }
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return { baseUrl, authHeader: `Basic ${token}` };
}

async function wooFetch<T = unknown>(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T; status: number }> {
  const { baseUrl, authHeader } = resolveWooConfig();
  const url = `${baseUrl}/wp-json/wc/v3${pathname}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: authHeader,
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

/**
 * Create or update a simple product by SKU. Returns Woo product id as string.
 */
export async function upsertWooCommerceProduct(
  payload: WooProductPayload,
): Promise<{ externalId: string }> {
  const list = await wooFetch<Array<{ id?: number; sku?: string }>>(
    `/products?sku=${encodeURIComponent(payload.sku)}&per_page=1`,
  );
  const existing = Array.isArray(list.data) ? list.data[0] : null;
  const existingId =
    existing && typeof existing.id === "number" ? existing.id : null;

  if (existingId != null) {
    const updated = await wooFetch<{ id?: number }>(
      `/products/${existingId}`,
      { method: "PUT", body: payload },
    );
    const id = updated.data?.id ?? existingId;
    return { externalId: String(id) };
  }

  const created = await wooFetch<{ id?: number }>("/products", {
    method: "POST",
    body: payload,
  });
  const id = created.data?.id;
  if (id == null || !Number.isFinite(Number(id))) {
    throw new WooCommerceApiError(
      "WooCommerce product create returned no id",
      created.status,
    );
  }
  return { externalId: String(id) };
}
