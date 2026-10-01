export const EMBED_AUTH_COOKIE = "ccpatio-embed-auth";
export const EMBED_AUTH_HEADER = "x-ccpatio-embed-auth";
export const EMBED_KEY_HEADER = "x-ccpatio-embed-key";
export const EMBED_CONTEXT_HEADER = "x-ccpatio-embed";

const EMBED_COOKIE_PAYLOAD = "ccpatio-embed-v1";
const EMBED_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function getGhlEmbedSecret(): string {
  return process.env.GHL_EMBED_SECRET?.trim() ?? "";
}

function timingSafeEqualString(left: string, right: string): boolean {
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
  const expected = await embedAuthCookieValue(secret);
  return timingSafeEqualString(expected, token);
}

export function embedAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: "/embed",
    maxAge: EMBED_COOKIE_MAX_AGE,
  };
}
