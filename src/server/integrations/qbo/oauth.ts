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
 * Signed connect secret for headless / ops initiation without a browser SuperAdmin session.
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

/** Browser-safe error body — never echo Intuit / upstream payloads. */
export function sanitizedQboOAuthError(
  code: string,
  message: string,
): { error: string; code: string } {
  return { error: message, code };
}

/** Fingerprint for server logs without leaking full token responses. */
export function fingerprintUpstreamBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function stripEnvQuotes(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}
