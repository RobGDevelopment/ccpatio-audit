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
  method: "GET" | "POST",
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
