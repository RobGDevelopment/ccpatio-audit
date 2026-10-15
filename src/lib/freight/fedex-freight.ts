/**
 * FedEx Freight LTL client (OAuth 2.0 + Rate Freight).
 *
 * There is NO fallback table here. When the integration is not configured, or FedEx does
 * not answer with a price we can read, this module throws a typed {@link FedExFreightError}
 * and the caller omits FedEx from the quote. A fabricated rate is never returned.
 *
 * Spec: Shipping/FedEx_Auth_Rate_Blueprint.md and Shipping/FedEx_Developer.md.
 *   POST {auth}/am/oauth2/access_token       form: grant_type, client_id, client_secret, scope=fxf-api
 *   POST {apiBase}/fxf-external-rate-auth0/fxfgw/rate/getRateQuote
 *
 * Error text from FedEx is never copied into an Error message or a log line. The only
 * provider data that survives is the HTTP status and `errors[].code` tokens.
 */
import { randomUUID } from "node:crypto";
import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import { logError } from "@/lib/log/structured";

export const FEDEX_FREIGHT_SANDBOX_AUTH_URL =
  "https://auth-qa.fedexfreight.com/am/oauth2/access_token";
export const FEDEX_FREIGHT_PRODUCTION_AUTH_URL =
  "https://auth.fedexfreight.com/am/oauth2/access_token";
export const FEDEX_FREIGHT_RATE_PATH = "/fxf-external-rate-auth0/fxfgw/rate/getRateQuote";
export const FEDEX_FREIGHT_DEFAULT_SERVICE = "FEDEX_FREIGHT_ECONOMY";
export const FEDEX_FREIGHT_CARRIER_NAME = "FedEx Freight";
export const FEDEX_FREIGHT_CARRIER_CODE = "FEDEX_FREIGHT";

const TOKEN_SKEW_MS = 60_000;
const AUTH_TIMEOUT_MS = 15_000;
const RATE_TIMEOUT_MS = 30_000;

export type FedExFreightErrorCode =
  | "NOT_CONFIGURED"
  | "BAD_REQUEST"
  | "AUTH_FAILED"
  | "RATE_FAILED"
  | "BAD_RESPONSE"
  | "TIMEOUT";

/** `code` is a stable token (the logger records it); `message` is always static text. */
export class FedExFreightError extends Error {
  readonly code: FedExFreightErrorCode;
  readonly status: number | null;
  /** `errors[].code` tokens from FedEx, never free text. */
  readonly providerCodes: string[];

  constructor(
    code: FedExFreightErrorCode,
    message: string,
    options: { status?: number | null; providerCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "FedExFreightError";
    this.code = code;
    this.status = options.status ?? null;
    this.providerCodes = options.providerCodes ?? [];
  }
}

export class FedExFreightNotConfiguredError extends FedExFreightError {
  /** Environment variable NAMES that are missing. Never values. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super("NOT_CONFIGURED", `FedEx Freight is not configured (${missing.join(", ")}).`);
    this.name = "FedExFreightNotConfiguredError";
    this.missing = missing;
  }
}

export type FedExFreightConfig = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  apiBase: string;
  accountNumber: string;
  serviceType: string;
};

type Env = Record<string, string | undefined>;

function pick(env: Env, ...names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/** Names of required settings that are absent. Empty array means ready. */
export function fedexFreightConfigGaps(env: Env = process.env): string[] {
  const gaps: string[] = [];
  if (!pick(env, "FEDEX_FREIGHT_CLIENT_ID", "FEDEX_SANDBOX_CLIENT_ID")) {
    gaps.push("FEDEX_FREIGHT_CLIENT_ID");
  }
  if (!pick(env, "FEDEX_FREIGHT_CLIENT_SECRET", "FEDEX_SANDBOX_CLIENT_SECRET")) {
    gaps.push("FEDEX_FREIGHT_CLIENT_SECRET");
  }
  if (!pick(env, "FEDEX_FREIGHT_API_BASE")) gaps.push("FEDEX_FREIGHT_API_BASE");
  if (!pick(env, "FEDEX_FREIGHT_ACCOUNT_NUMBER")) gaps.push("FEDEX_FREIGHT_ACCOUNT_NUMBER");
  return gaps;
}

export function isFedExFreightConfigured(env: Env = process.env): boolean {
  return fedexFreightConfigGaps(env).length === 0;
}

function assertHttps(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    // The URL text is operator-supplied config; name the setting, not the value.
    void error;
    throw new FedExFreightError("NOT_CONFIGURED", `${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new FedExFreightError("NOT_CONFIGURED", `${label} must use https.`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function readFedExFreightConfig(env: Env = process.env): FedExFreightConfig {
  const gaps = fedexFreightConfigGaps(env);
  if (gaps.length > 0) throw new FedExFreightNotConfiguredError(gaps);

  const production = pick(env, "FEDEX_FREIGHT_ENV").toLowerCase() === "production";
  const authUrl = assertHttps(
    pick(env, "FEDEX_FREIGHT_AUTH_URL") ||
      (production ? FEDEX_FREIGHT_PRODUCTION_AUTH_URL : FEDEX_FREIGHT_SANDBOX_AUTH_URL),
    "FEDEX_FREIGHT_AUTH_URL",
  );
  const accountNumber = pick(env, "FEDEX_FREIGHT_ACCOUNT_NUMBER");
  if (!/^[A-Za-z0-9]{1,9}$/.test(accountNumber)) {
    throw new FedExFreightError(
      "NOT_CONFIGURED",
      "FEDEX_FREIGHT_ACCOUNT_NUMBER must be 1 to 9 letters or digits.",
    );
  }
  return {
    clientId: pick(env, "FEDEX_FREIGHT_CLIENT_ID", "FEDEX_SANDBOX_CLIENT_ID"),
    clientSecret: pick(env, "FEDEX_FREIGHT_CLIENT_SECRET", "FEDEX_SANDBOX_CLIENT_SECRET"),
    authUrl,
    apiBase: assertHttps(pick(env, "FEDEX_FREIGHT_API_BASE"), "FEDEX_FREIGHT_API_BASE"),
    accountNumber,
    serviceType: pick(env, "FEDEX_FREIGHT_SERVICE_TYPE") || FEDEX_FREIGHT_DEFAULT_SERVICE,
  };
}

// ---------------------------------------------------------------------------
// OAuth token cache
// ---------------------------------------------------------------------------

type CachedToken = { key: string; token: string; expiresAtMs: number };
let tokenCache: CachedToken | null = null;
let tokenInFlight: { key: string; promise: Promise<string> } | null = null;

export function resetFedExTokenCache(): void {
  tokenCache = null;
  tokenInFlight = null;
}

export type FedExDeps = {
  fetch?: typeof fetch;
  /** Epoch ms. */
  now?: () => number;
  env?: Env;
};

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function requestToken(
  config: FedExFreightConfig,
  doFetch: typeof fetch,
  nowMs: number,
): Promise<CachedToken> {
  const key = `${config.authUrl}|${config.clientId}`;
  let response: Response;
  try {
    response = await doFetch(config.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "fxf-api",
      }).toString(),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLike(error)) {
      throw new FedExFreightError("TIMEOUT", "FedEx Freight sign-in timed out.");
    }
    throw new FedExFreightError("AUTH_FAILED", "FedEx Freight sign-in could not reach FedEx.");
  }
  if (!response.ok) {
    throw new FedExFreightError(
      "AUTH_FAILED",
      `FedEx Freight sign-in was refused (HTTP ${response.status}).`,
      { status: response.status },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    void error;
    throw new FedExFreightError("AUTH_FAILED", "FedEx Freight sign-in returned a non-JSON body.", {
      status: response.status,
    });
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const token = record.access_token;
  const expiresIn = Number(record.expires_in);
  if (typeof token !== "string" || !token.trim()) {
    throw new FedExFreightError("AUTH_FAILED", "FedEx Freight sign-in returned no access token.", {
      status: response.status,
    });
  }
  // The spec says 3600 s. Fall back to 10 minutes if the field is missing or odd.
  const lifetimeMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 600_000;
  return { key, token, expiresAtMs: nowMs + lifetimeMs };
}

async function getAccessToken(
  config: FedExFreightConfig,
  doFetch: typeof fetch,
  now: () => number,
): Promise<string> {
  const key = `${config.authUrl}|${config.clientId}`;
  const nowMs = now();
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAtMs - TOKEN_SKEW_MS > nowMs) {
    return tokenCache.token;
  }
  // The auth endpoint is limited to 5 calls per second: concurrent callers share one request.
  if (tokenInFlight && tokenInFlight.key === key) return tokenInFlight.promise;

  const promise = requestToken(config, doFetch, nowMs)
    .then((fresh) => {
      tokenCache = fresh;
      return fresh.token;
    })
    .finally(() => {
      if (tokenInFlight?.promise === promise) tokenInFlight = null;
    });
  tokenInFlight = { key, promise };
  return promise;
}

// ---------------------------------------------------------------------------
// Request mapping
// ---------------------------------------------------------------------------

const CLASS_SET = new Set<string>(LTL_FREIGHT_CLASSES);

/** "77.5" -> "CLASS_077_5", "50" -> "CLASS_050", "175" -> "CLASS_175". */
export function toFedExFreightClass(freightClass: string): string {
  const trimmed = freightClass.trim();
  if (!CLASS_SET.has(trimmed)) {
    throw new FedExFreightError("BAD_REQUEST", `Unknown NMFC class ${trimmed || "(blank)"}.`);
  }
  const [whole, fraction] = trimmed.split(".");
  const padded = whole!.padStart(3, "0");
  return fraction ? `CLASS_${padded}_${fraction}` : `CLASS_${padded}`;
}

export type FedExRateInput = {
  originZip: string;
  destZip: string;
  /** One handling unit (the collapsed skid) per entry. */
  items: Array<{
    weightLb: number;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    freightClass: string;
  }>;
};

function zip5(raw: string, label: string): string {
  const zip = raw.trim();
  if (!/^\d{5}$/.test(zip)) {
    throw new FedExFreightError("BAD_REQUEST", `${label} must be a 5-digit US ZIP.`);
  }
  return zip;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FedExFreightError("BAD_REQUEST", `${label} must be greater than 0.`);
  }
  return value;
}

/** Carriers bill up, so weight rounds up to 0.1 lb and dimensions up to the next inch. */
export function buildFedExRateRequest(
  input: FedExRateInput,
  config: Pick<FedExFreightConfig, "accountNumber" | "serviceType">,
): Record<string, unknown> {
  if (input.items.length === 0) {
    throw new FedExFreightError("BAD_REQUEST", "A FedEx Freight rate needs at least one item.");
  }
  const lines = input.items.map((item, index) => {
    const where = `Item ${index + 1}`;
    const weight = Math.ceil(positive(item.weightLb, `${where} weight`) * 10) / 10;
    return {
      weight: { value: weight, units: "LB" },
      dimensions: {
        length: Math.ceil(positive(item.lengthIn, `${where} length`)),
        width: Math.ceil(positive(item.widthIn, `${where} width`)),
        height: Math.ceil(positive(item.heightIn, `${where} height`)),
        units: "IN",
      },
      freightClass: toFedExFreightClass(item.freightClass),
    };
  });
  const totalWeight = Math.round(lines.reduce((sum, line) => sum + line.weight.value, 0) * 10) / 10;

  return {
    accountNumber: { value: config.accountNumber },
    rateRequestControlParameters: { returnTransitTimes: true },
    freightRequestedShipment: {
      serviceType: config.serviceType,
      packagingType: "PALLET",
      totalWeight: { value: totalWeight, units: "LB" },
      origin: { address: { postalCode: zip5(input.originZip, "Origin ZIP"), countryCode: "US" } },
      destination: {
        address: { postalCode: zip5(input.destZip, "Destination ZIP"), countryCode: "US" },
      },
      requestedPackageLineItems: lines,
    },
  };
}

// ---------------------------------------------------------------------------
// Response parsing (defensive: the response schema is only partly documented)
// ---------------------------------------------------------------------------

export type FedExFreightRate = {
  serviceType: string;
  serviceName: string | null;
  /** All-in USD total FedEx quoted for the shipment. */
  totalUsd: number;
  transitDays: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (isRecord(value)) return toMoney(value.amount ?? value.value);
  return null;
}

const WORD_DAYS: Record<string, number> = {
  ONE_DAY: 1,
  TWO_DAYS: 2,
  THREE_DAYS: 3,
  FOUR_DAYS: 4,
  FIVE_DAYS: 5,
  SIX_DAYS: 6,
  SEVEN_DAYS: 7,
  EIGHT_DAYS: 8,
  NINE_DAYS: 9,
  TEN_DAYS: 10,
};

function toDays(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
  if (typeof value === "string") {
    const word = WORD_DAYS[value.trim().toUpperCase()];
    if (word) return word;
    if (/^\d+$/.test(value.trim())) return toDays(Number(value));
  }
  return null;
}

function transitDaysOf(reply: Record<string, unknown>): number | null {
  const commit = isRecord(reply.commit) ? reply.commit : null;
  if (!commit) return toDays(reply.transitDays);
  const nested = isRecord(commit.transitDays) ? commit.transitDays : null;
  return (
    toDays(commit.transitDays) ??
    toDays(nested?.maximumTransitTime) ??
    toDays(nested?.minimumTransitTime) ??
    toDays(nested?.description) ??
    toDays(commit.maximumTransitTime) ??
    toDays(commit.minimumTransitTime)
  );
}

function chargeOf(detail: Record<string, unknown>): number | null {
  const shipment = isRecord(detail.shipmentRateDetail) ? detail.shipmentRateDetail : {};
  const candidates = [
    detail.totalNetCharge,
    detail.totalNetFedExCharge,
    shipment.totalNetCharge,
    shipment.totalNetFedExCharge,
  ];
  for (const candidate of candidates) {
    const money = toMoney(candidate);
    if (money !== null) return money;
  }
  return null;
}

function currencyOk(detail: Record<string, unknown>): boolean {
  const shipment = isRecord(detail.shipmentRateDetail) ? detail.shipmentRateDetail : {};
  const currency = detail.currency ?? shipment.currency;
  return currency === undefined || currency === null || String(currency).toUpperCase() === "USD";
}

/** Returns every readable price, cheapest first. Throws BAD_RESPONSE when there is none. */
export function parseFedExRateResponse(body: unknown, status = 200): FedExFreightRate[] {
  const output = isRecord(body) && isRecord(body.output) ? body.output : null;
  const replies = output && Array.isArray(output.rateReplyDetails) ? output.rateReplyDetails : null;
  if (!replies) {
    throw new FedExFreightError("BAD_RESPONSE", "FedEx Freight returned no rate details.", {
      status,
    });
  }

  const rates: FedExFreightRate[] = [];
  for (const reply of replies) {
    if (!isRecord(reply)) continue;
    const details = Array.isArray(reply.ratedShipmentDetails)
      ? reply.ratedShipmentDetails
      : [reply];
    let best: number | null = null;
    for (const detail of details) {
      if (!isRecord(detail) || !currencyOk(detail)) continue;
      const charge = chargeOf(detail);
      if (charge !== null && (best === null || charge < best)) best = charge;
    }
    if (best === null || best <= 0) continue;
    rates.push({
      serviceType: typeof reply.serviceType === "string" ? reply.serviceType : "UNKNOWN",
      serviceName: typeof reply.serviceName === "string" ? reply.serviceName : null,
      totalUsd: Math.round((best + Number.EPSILON) * 100) / 100,
      transitDays: transitDaysOf(reply),
    });
  }

  if (rates.length === 0) {
    throw new FedExFreightError("BAD_RESPONSE", "FedEx Freight returned no usable price.", {
      status,
    });
  }
  return rates.sort((a, b) => a.totalUsd - b.totalUsd);
}

const PROVIDER_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

async function providerCodesFrom(response: Response): Promise<string[]> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // An unreadable error body only costs detail (the HTTP status is on the thrown error). Say so.
    logError("fedex-freight-error-body-unreadable", error, { status: response.status });
    return [];
  }
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const codes: string[] = [];
  for (const entry of errors) {
    const code = isRecord(entry) ? entry.code : null;
    if (typeof code === "string" && PROVIDER_CODE.test(code) && codes.length < 5) codes.push(code);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Every FedEx Freight price for the shipment, cheapest first. Throws a typed error on any failure. */
export async function getFedExFreightRates(
  input: FedExRateInput,
  deps: FedExDeps = {},
): Promise<FedExFreightRate[]> {
  const config = readFedExFreightConfig(deps.env ?? process.env);
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const payload = JSON.stringify(buildFedExRateRequest(input, config));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken(config, doFetch, now);
    let response: Response;
    try {
      response = await doFetch(`${config.apiBase}${FEDEX_FREIGHT_RATE_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-client-id": config.clientId,
          "x-locale": "en_US",
          "x-customer-transaction-id": randomUUID(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(RATE_TIMEOUT_MS),
      });
    } catch (error) {
      if (isAbortLike(error)) {
        throw new FedExFreightError("TIMEOUT", "FedEx Freight rating timed out.");
      }
      throw new FedExFreightError("RATE_FAILED", "FedEx Freight rating could not reach FedEx.");
    }

    // A 401 means the cached token expired early or was revoked: sign in again, once.
    if (response.status === 401) {
      resetFedExTokenCache();
      if (attempt === 0) continue;
      throw new FedExFreightError("AUTH_FAILED", "FedEx Freight rejected a fresh token.", {
        status: 401,
        providerCodes: await providerCodesFrom(response),
      });
    }
    if (!response.ok) {
      throw new FedExFreightError(
        "RATE_FAILED",
        `FedEx Freight rating was refused (HTTP ${response.status}).`,
        { status: response.status, providerCodes: await providerCodesFrom(response) },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      void error;
      throw new FedExFreightError("BAD_RESPONSE", "FedEx Freight returned a non-JSON body.", {
        status: response.status,
      });
    }
    return parseFedExRateResponse(body, response.status);
  }

  // Unreachable: the second pass always returns or throws above. Kept so the type checker agrees.
  throw new FedExFreightError("AUTH_FAILED", "FedEx Freight rejected a fresh token.", {
    status: 401,
  });
}

export type FedExFreightQuote = {
  carrier: string;
  rate: number;
  days: number | null;
  serviceType: string;
};

/** The single cheapest FedEx Freight option. */
export async function getFedExFreightQuote(
  input: FedExRateInput,
  deps: FedExDeps = {},
): Promise<FedExFreightQuote> {
  const [cheapest] = await getFedExFreightRates(input, deps);
  if (!cheapest) {
    throw new FedExFreightError("BAD_RESPONSE", "FedEx Freight returned no usable price.");
  }
  return {
    carrier: FEDEX_FREIGHT_CARRIER_NAME,
    rate: cheapest.totalUsd,
    days: cheapest.transitDays,
    serviceType: cheapest.serviceType,
  };
}
