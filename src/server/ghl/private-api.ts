const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export type GhlConfig = {
  token: string;
  locationId: string;
};

export function readGhlConfig(): GhlConfig | { error: string } {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim() ?? "";
  const locationId = process.env.GHL_LOCATION_ID?.trim() ?? "";
  if (!token || !locationId) {
    return { error: "GoHighLevel private integration is not configured." };
  }
  return { token, locationId };
}

export function asGhlRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type GhlResult =
  | { ok: true; body: unknown; locationId: string }
  | { ok: false; error: string };

async function ghlFetch(
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
): Promise<GhlResult> {
  const config = readGhlConfig();
  if ("error" in config) return { ok: false, error: config.error };

  let response: Response;
  try {
    response = await fetch(`${GHL_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "GoHighLevel request failed.";
    return { ok: false, error: message };
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const record = asGhlRecord(body);
    const message =
      typeof record?.message === "string" && record.message.trim()
        ? record.message.trim()
        : `GoHighLevel returned ${response.status}.`;
    return { ok: false, error: message };
  }
  return { ok: true, body, locationId: config.locationId };
}

export function ghlGet(path: string): Promise<GhlResult> {
  return ghlFetch("GET", path);
}

export function ghlPost(path: string, body: unknown): Promise<GhlResult> {
  return ghlFetch("POST", path, body);
}

export function ghlPut(path: string, body: unknown): Promise<GhlResult> {
  return ghlFetch("PUT", path, body);
}

/**
 * Mirror a quote total onto the opportunity. The quote is never read back
 * from this value. Write scope is opportunities.write on the private token.
 */
export async function updateOpportunityValue(
  opportunityId: string,
  value: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = opportunityId.trim();
  if (!id) return { ok: false, error: "Opportunity id is required." };
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "Opportunity value must be zero or greater." };
  }

  const loaded = await ghlGet(`/opportunities/${encodeURIComponent(id)}`);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const record = asGhlRecord(loaded.body);
  const opportunity = asGhlRecord(record?.opportunity) ?? record;
  const locationId =
    typeof opportunity?.locationId === "string" ? opportunity.locationId.trim() : "";
  if (locationId && locationId !== loaded.locationId) {
    return { ok: false, error: "That opportunity is in a different location." };
  }

  const updated = await ghlPut(`/opportunities/${encodeURIComponent(id)}`, {
    monetaryValue: Number(value.toFixed(2)),
  });
  if (!updated.ok) return { ok: false, error: updated.error };
  return { ok: true };
}
