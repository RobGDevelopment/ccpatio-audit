/**
 * QBO OAuth initiation + callback hardening helpers.
 * State cookie CSRF lock, optional realm allowlist, sanitized browser errors.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { timingSafeEqualString } from "@/lib/embed-auth";

export const QBO_OAUTH_STATE_COOKIE = "qbo_oauth_state";
/** Short-lived CSRF state — 10 minutes. */
export const QBO_OAUTH_STATE_MAX_AGE_SEC = 600;
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_OAUTH_SCOPES = "com.intuit.quickbooks.accounting openid profile email";

export type QboOAuthStateCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function mintQboOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function qboOAuthStateCookieOptions(secure: boolean): QboOAuthStateCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: QBO_OAUTH_STATE_MAX_AGE_SEC,
  };
}

/** Constant-time compare for OAuth `state` vs cookie (rejects empty / length mismatch). */
export function oauthStateMatches(
  provided: string | null | undefined,
  cookieValue: string | null | undefined,
): boolean {
  const left = (provided ?? "").trim();
  const right = (cookieValue ?? "").trim();
  if (!left || !right) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * When `QBO_EXPECTED_REALM_ID` is set, only that company may complete OAuth.
 * When unset/blank, any realmId is accepted (dev/sandbox flexibility).
 */
export function isAllowedQboRealmId(
  realmId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = env.QBO_EXPECTED_REALM_ID?.trim() ?? "";
  if (!expected) return true;
  return timingSafeEqualString(realmId.trim(), expected);
}

/**
 * Signed connect secret for headless / ops initiation without a browser Mission Control session.
 * Accepts `QBO_CONNECT_SECRET` via header or query.
 */
export function isValidQboConnectSecret(
  provided: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = env.QBO_CONNECT_SECRET?.trim() ?? "";
  const got = (provided ?? "").trim();
  if (!expected || !got) return false;
  return timingSafeEqualString(got, expected);
}

/** Mission Control operators who may start QBO OAuth from `/api/auth/qbo/connect`. */
export function canInitiateQboOAuth(role: string | null | undefined): boolean {
  return role === "SuperAdmin" || role === "IT_Admin";
}

export function buildQboAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string;
}): string {
  const url = new URL(QBO_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes ?? QBO_OAUTH_SCOPES);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** Non-secret Intuit OAuth error codes safe to log / return to operators. */
export const QBO_OAUTH_UPSTREAM_ERROR_CODES = new Set([
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
]);

export type SanitizedQboOAuthError = {
  error: string;
  code: string;
  /** Allowlisted Intuit OAuth `error` only — never descriptions or tokens. */
  oauth_error?: string;
};

/** Browser-safe error body — never echo Intuit / upstream payloads. */
export function sanitizedQboOAuthError(
  code: string,
  message: string,
  extras?: { oauth_error?: string | null },
): SanitizedQboOAuthError {
  const out: SanitizedQboOAuthError = { error: message, code };
  const oauthError = extras?.oauth_error?.trim();
  if (oauthError && QBO_OAUTH_UPSTREAM_ERROR_CODES.has(oauthError)) {
    out.oauth_error = oauthError;
  }
  return out;
}

/**
 * Extract Intuit's non-secret OAuth `error` code from a token endpoint body.
 * Returns null when missing, malformed, or not in the allowlist.
 */
export function parseIntuitOAuthErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error !== "string") return null;
    const code = parsed.error.trim();
    return QBO_OAUTH_UPSTREAM_ERROR_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

/** Fingerprint for server logs without leaking full token responses. */
export function fingerprintUpstreamBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** Trim BOM/whitespace and strip a single wrapping quote pair from env values. */
export function stripEnvQuotes(value: string | undefined): string {
  return (value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/** Safe metadata for diagnosing credential/redirect misconfig without secrets. */
export function qboCredentialLogMeta(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Record<string, string | number | boolean> {
  return {
    clientIdLength: input.clientId.length,
    clientIdPrefix4: input.clientId.slice(0, 4),
    clientIdSuffix4: input.clientId.slice(-4),
    clientSecretLength: input.clientSecret.length,
    clientSecretPrefix4: input.clientSecret.slice(0, 4),
    clientSecretSuffix4: input.clientSecret.slice(-4),
    redirectUri: input.redirectUri,
    redirectUriLength: input.redirectUri.length,
  };
}
