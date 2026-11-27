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

/** Trim BOM/whitespace/`\r`/`\n` and strip a single wrapping quote pair from env values. */
export function stripEnvQuotes(value: string | undefined): string {
  return (value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n]+/g, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

export type SanitizedQboConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
  /** True when any raw env value differed after strip (whitespace / quotes / CR/LF). */
  trimmedWhitespaceOrQuotes: boolean;
  clientIdPrefix: string;
  clientIdLength: number;
  clientSecretLength: number;
  /** First 8 hex chars of SHA-256(clientSecret) — safe fingerprint, never the secret. */
  secretSha256Prefix8: string;
};

function rawEnvDiffered(raw: string | undefined, sanitized: string): boolean {
  if (raw == null) return false;
  return raw !== sanitized;
}

/**
 * Shared QBO env sanitizer — strips Windows/`vercel env add` whitespace, CR/LF,
 * and accidental surrounding quotes. Prefer Vercel Production name
 * `QBO_OAUTH_REDIRECT_URI`, fall back to `QBO_REDIRECT_URI`. When `origin` is
 * provided and no redirect env is set (or it does not match the request origin
 * host), uses `${origin}/api/auth/qbo/callback`.
 */
export function getSanitizedQboConfig(
  env: Record<string, string | undefined> = process.env,
  origin?: string | null,
): SanitizedQboConfig {
  const rawClientId = env.QBO_CLIENT_ID;
  const rawClientSecret = env.QBO_CLIENT_SECRET;
  // Vercel Production uses QBO_OAUTH_REDIRECT_URI — prefer it over legacy alias.
  const rawRedirect =
    env.QBO_OAUTH_REDIRECT_URI ?? env.QBO_REDIRECT_URI ?? undefined;
  const rawEnvironment = env.QBO_ENVIRONMENT;

  const clientId = stripEnvQuotes(rawClientId);
  const clientSecret = stripEnvQuotes(rawClientSecret);
  const configuredRedirect = stripEnvQuotes(rawRedirect);
  const environmentRaw = stripEnvQuotes(rawEnvironment).toLowerCase();
  const environment: "sandbox" | "production" =
    environmentRaw === "production" ? "production" : "sandbox";

  let redirectUri = configuredRedirect;
  if (origin) {
    const canonical = `${origin.replace(/\/$/, "")}/api/auth/qbo/callback`;
    if (!configuredRedirect) {
      redirectUri = canonical;
    } else {
      try {
        const configuredHost = new URL(configuredRedirect).origin;
        const requestOrigin = new URL(origin).origin;
        if (configuredHost !== requestOrigin) {
          redirectUri = canonical;
        }
      } catch {
        redirectUri = canonical;
      }
    }
  }

  const trimmedWhitespaceOrQuotes =
    rawEnvDiffered(rawClientId, clientId) ||
    rawEnvDiffered(rawClientSecret, clientSecret) ||
    rawEnvDiffered(rawRedirect, configuredRedirect) ||
    rawEnvDiffered(rawEnvironment, stripEnvQuotes(rawEnvironment));

  const secretSha256Prefix8 = clientSecret
    ? createHash("sha256").update(clientSecret, "utf8").digest("hex").slice(0, 8)
    : "";

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment,
    trimmedWhitespaceOrQuotes,
    clientIdPrefix: clientId.slice(0, 6),
    clientIdLength: clientId.length,
    clientSecretLength: clientSecret.length,
    secretSha256Prefix8,
  };
}

/** Safe operator diagnostics — never includes secrets. */
export function qboSafeCredentialDiagnostics(config: SanitizedQboConfig): {
  environment: string;
  redirectUri: string;
  clientIdPrefix: string;
  clientIdLength: number;
  clientSecretLength: number;
  trimmedWhitespaceOrQuotes: boolean;
  secretSha256Prefix8: string;
} {
  return {
    environment: config.environment,
    redirectUri: config.redirectUri,
    clientIdPrefix: config.clientIdPrefix,
    clientIdLength: config.clientIdLength,
    clientSecretLength: config.clientSecretLength,
    trimmedWhitespaceOrQuotes: config.trimmedWhitespaceOrQuotes,
    secretSha256Prefix8: config.secretSha256Prefix8,
  };
}

export type QboCredentialPairProbeResult = {
  oauthError: string | null;
  verdict: "valid_pair" | "mismatch" | "other";
  label: string;
  secretSha256Prefix8: string;
  httpStatus: number;
};

/**
 * Zero-side-effect RFC 6749 probe: exchange a deliberately invalid auth code.
 * `invalid_grant` ⇒ Client ID/Secret pair is accepted by Intuit.
 * `invalid_client` ⇒ Client ID / Secret mismatch (or whitespace/encoding).
 */
export async function probeQboCredentialPair(
  env: Record<string, string | undefined> = process.env,
  origin?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<QboCredentialPairProbeResult> {
  const config = getSanitizedQboConfig(env, origin);
  const { clientId, clientSecret, redirectUri, secretSha256Prefix8 } = config;
  if (!clientId || !clientSecret || !redirectUri) {
    return {
      oauthError: "misconfigured",
      verdict: "other",
      label: "Missing QBO Client ID / Secret / Redirect URI",
      secretSha256Prefix8,
      httpStatus: 0,
    };
  }
  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "ccpatio_credential_pair_probe_invalid",
    redirect_uri: redirectUri,
  });
  const res = await fetchImpl("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader,
    },
    body: body.toString(),
  });
  const text = await res.text();
  const oauthError = parseIntuitOAuthErrorCode(text);
  if (oauthError === "invalid_grant") {
    return {
      oauthError,
      verdict: "valid_pair",
      label: "Credentials Pair Valid — Ready to Authorize",
      secretSha256Prefix8,
      httpStatus: res.status,
    };
  }
  if (oauthError === "invalid_client") {
    return {
      oauthError,
      verdict: "mismatch",
      label: "Client ID / Secret Mismatch",
      secretSha256Prefix8,
      httpStatus: res.status,
    };
  }
  return {
    oauthError,
    verdict: "other",
    label: `Unexpected probe result (${oauthError ?? `HTTP ${res.status}`})`,
    secretSha256Prefix8,
    httpStatus: res.status,
  };
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

export const QBO_OAUTH_RESULT_MESSAGE_TYPE = "ccpatio:qbo-oauth-result";

/** Detect browser OAuth redirects that must receive HTML (never raw JSON). */
export function prefersQboHtmlCallback(req: Request): boolean {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  if (accept.includes("text/html")) return true;
  // Standard OAuth redirect often omits Accept or sends */*
  if (!accept || accept.includes("*/*")) {
    const secFetch = (req.headers.get("sec-fetch-mode") ?? "").toLowerCase();
    const secDest = (req.headers.get("sec-fetch-dest") ?? "").toLowerCase();
    if (secFetch === "navigate" || secDest === "document") return true;
    // Popup navigations from window.open typically look like browser navigations
    const upgrade = (req.headers.get("upgrade-insecure-requests") ?? "").trim();
    if (upgrade === "1") return true;
  }
  return false;
}
