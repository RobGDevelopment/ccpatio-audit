/**
 * Clover Inventory REST helper for MDM catalog fan-out.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4.
 */
import type { CloverItemPayload } from "@/mappers/clover";

export class CloverApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CloverApiError";
    this.status = status;
  }
}

function resolveCloverConfig(): { merchantId: string; token: string } {
  const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
  const token = process.env.CLOVER_API_TOKEN?.trim();
  if (!merchantId || !token) {
    throw new CloverApiError(
      "Missing CLOVER_MERCHANT_ID / CLOVER_API_TOKEN",
      0,
    );
  }
  return { merchantId, token };
}

async function cloverFetch<T = unknown>(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T; status: number }> {
  const { merchantId, token } = resolveCloverConfig();
  const base =
    process.env.CLOVER_API_BASE?.trim().replace(/\/$/, "") ||
    "https://api.clover.com";
  const url = `${base}/v3/merchants/${merchantId}${pathname}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
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
        : `Clover HTTP ${response.status}`;
    throw new CloverApiError(message, response.status);
  }

  return { data: parsed as T, status: response.status };
}

/**
 * Create or update a Clover inventory item by SKU. Returns Clover item id.
 */
export async function upsertCloverItem(
  payload: CloverItemPayload,
): Promise<{ externalId: string }> {
  const list = await cloverFetch<{
    elements?: Array<{ id?: string; sku?: string }>;
  }>(`/items?filter=sku%3D${encodeURIComponent(payload.sku)}&limit=1`);

  const existing = Array.isArray(list.data?.elements)
    ? list.data.elements[0]
    : null;
  const existingId =
    existing && typeof existing.id === "string" ? existing.id : null;

  if (existingId) {
    const updated = await cloverFetch<{ id?: string }>(`/items/${existingId}`, {
      method: "POST",
      body: payload,
    });
    return { externalId: updated.data?.id ?? existingId };
  }

  const created = await cloverFetch<{ id?: string }>("/items", {
    method: "POST",
    body: payload,
  });
  const id = created.data?.id;
  if (!id) {
    throw new CloverApiError(
      "Clover item create returned no id",
      created.status,
    );
  }
  return { externalId: id };
}
