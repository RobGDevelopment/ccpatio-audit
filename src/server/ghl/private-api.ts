import { logError, logStructured } from "@/lib/log/structured";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

/**
 * First path segment only (`/contacts/abc?query=jane@x.com` becomes `contacts`), so a log line
 * never carries an id, a search term or a customer email.
 */
function routeOf(path: string): string {
  const segment = path.split("?")[0]?.split("/").find((part) => part.length > 0) ?? "";
  return /^[A-Za-z0-9_-]{1,32}$/.test(segment) ? segment : "unknown";
}

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
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<GhlResult> {
  const config = readGhlConfig();
  if ("error" in config) return { ok: false, error: config.error };

  const route = routeOf(path);
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
  } catch (error) {
    // The transport error text can echo the request URL. Log the fingerprint, return the ref.
    const ref = logError("ghl-request-failed", error, { method, route });
    return { ok: false, error: `GoHighLevel request failed. Reference ${ref}.` };
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch (error) {
      // A non-JSON body (an HTML gateway page, say) is not a success: say so instead of
      // inventing a `{ message }` body from the provider's text.
      const ref = logError("ghl-response-not-json", error, {
        method,
        route,
        status: response.status,
      });
      if (response.ok) {
        return { ok: false, error: `GoHighLevel returned an unreadable response. Reference ${ref}.` };
      }
    }
  }
  if (!response.ok) {
    // Provider text is never copied into the error. Status and route are enough to triage.
    logStructured("warn", "ghl-request-refused", { method, route, status: response.status });
    return { ok: false, error: `GoHighLevel returned ${response.status}.` };
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

export function ghlDelete(path: string, body: unknown): Promise<GhlResult> {
  return ghlFetch("DELETE", path, body);
}

/**
 * Mirror a quote total onto the opportunity. The quote is never read back
 * from this value. Write scope is opportunities.write on the private token.
 */
export async function updateOpportunityValue(
  opportunityId: string,
  value: number,
  carrierName?: string
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

  const payload: Record<string, unknown> = {
    monetaryValue: Number(value.toFixed(2)),
  };

  if (carrierName) {
    const currentName = typeof opportunity?.name === "string" ? opportunity.name : typeof opportunity?.contactName === "string" ? opportunity.contactName : "";
    const cleanName = currentName.replace(/\s*\[Quote-Frozen:.*?\]\s*/g, "");
    payload.name = `${cleanName} [Quote-Frozen: ${carrierName}]`.trim();
  }

  const updated = await ghlPut(`/opportunities/${encodeURIComponent(id)}`, payload);
  if (!updated.ok) return { ok: false, error: updated.error };
  return { ok: true };
}
