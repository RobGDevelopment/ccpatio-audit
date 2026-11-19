export const EMBED_AUTH_COOKIE = "ccpatio-embed-auth";
export const EMBED_AUTH_HEADER = "x-ccpatio-embed-auth";
export const EMBED_KEY_HEADER = "x-ccpatio-embed-key";
export const EMBED_CONTEXT_HEADER = "x-ccpatio-embed";
/** Cookie-independent HMAC session token for GHL cross-origin iframes (CHIPS fallback). */
export const EMBED_TOKEN_HEADER = "x-ccpatio-embed-token";

const EMBED_COOKIE_PAYLOAD = "ccpatio-embed-v1";
const EMBED_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
/** Short-lived signed embed session (2 hours). */
const EMBED_TOKEN_TTL_SEC = 60 * 60 * 2;
const EMBED_TOKEN_PREFIX = "ccpatio-embed-sess";

export function getGhlEmbedSecret(): string {
  return process.env.GHL_EMBED_SECRET?.trim() ?? "";
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function embedKeyIsValid(key: string | null, secret: string): boolean {
  if (!key || !secret) return false;
  return timingSafeEqualString(key, secret);
}

export async function embedAuthCookieValue(secret: string): Promise<string> {
  return hmacSha256Hex(secret, EMBED_COOKIE_PAYLOAD);
}

export async function embedCookieIsValid(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token || !secret) return false;
  // Accept either the raw embed secret (legacy cookie) or the HMAC cookie value.
  if (embedKeyIsValid(token, secret)) return true;
  const expected = await embedAuthCookieValue(secret);
  return timingSafeEqualString(expected, token);
}

/**
 * SameSite=None; Secure; Partitioned (CHIPS) so the cookie survives inside
 * app.gohighlevel.com iframes. Path `/` so /api and Server Actions both receive it.
 */
export function embedAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: "/",
    maxAge: EMBED_COOKIE_MAX_AGE,
  };
}

/** Serialize cookie attributes for Set-Cookie audits / unit tests. */
export function embedAuthCookieAttributeString(): string {
  const opts = embedAuthCookieOptions();
  return [
    `${EMBED_AUTH_COOKIE}=<token>`,
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Partitioned",
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
  ].join("; ");
}

export type EmbedSessionClaims = {
  exp: number;
  iat: number;
};

/** Edge-safe base64url (no Node Buffer — proxy/middleware runs on Edge). */
function encodePart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePart(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Mint a short-lived HMAC-signed embed session token.
 * Format: `<prefix>.<base64url(json claims)>.<hmac-hex>`
 */
export async function mintEmbedSessionToken(
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!secret) throw new Error("GHL_EMBED_SECRET is required to mint an embed session token.");
  const claims: EmbedSessionClaims = {
    iat: nowSec,
    exp: nowSec + EMBED_TOKEN_TTL_SEC,
  };
  const body = encodePart(JSON.stringify(claims));
  const sig = await hmacSha256Hex(secret, `${EMBED_TOKEN_PREFIX}.${body}`);
  return `${EMBED_TOKEN_PREFIX}.${body}.${sig}`;
}

export async function verifyEmbedSessionToken(
  token: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<EmbedSessionClaims | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, body, sig] = parts;
  if (prefix !== EMBED_TOKEN_PREFIX || !body || !sig) return null;
  const expected = await hmacSha256Hex(secret, `${EMBED_TOKEN_PREFIX}.${body}`);
  if (!timingSafeEqualString(expected, sig)) return null;
  try {
    const claims = JSON.parse(decodePart(body)) as EmbedSessionClaims;
    if (
      typeof claims.exp !== "number" ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat)
    ) {
      return null;
    }
    if (claims.exp < nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}

export function embedTokenTtlSeconds(): number {
  return EMBED_TOKEN_TTL_SEC;
}
