export const E2E_GODMODE_COOKIE = "ccpatio_e2e_godmode";
export const E2E_GODMODE_LOCAL_SECRET = "local-e2e-godmode-secret";

/**
 * HMAC secret for the E2E god-mode cookie/header.
 * Next's proxy isolate drops most non-NEXT_PUBLIC_ env vars, so local
 * `next start` cannot be trusted to see E2E_GODMODE_SECRET. Use the
 * built-in local secret off Vercel. On Vercel this returns empty unless
 * the env var is explicitly configured (do not do that in production).
 */
export function getE2eGodModeSecret(): string {
  if (process.env.VERCEL) {
    return process.env.E2E_GODMODE_SECRET?.trim() ?? "";
  }
  return E2E_GODMODE_LOCAL_SECRET;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeCookiePayload(payload: string): string {
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

function decodeCookiePayload(value: string): string {
  if (value.includes("|")) return value;
  return new TextDecoder().decode(base64UrlToBytes(value));
}

export async function signE2eGodModeCookie(
  email: string,
  secret: string,
  ttlMs = 2 * 60 * 60 * 1000,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const exp = Date.now() + ttlMs;
  const payload = `${normalized}|${exp}`;
  const mac = await hmacSha256Hex(secret, payload);
  return encodeCookiePayload(`${payload}|${mac}`);
}

export async function verifyE2eGodModeCookie(
  value: string | undefined | null,
  secret: string,
): Promise<{ email: string } | null> {
  if (!value || !secret) return null;
  let decoded = value;
  try {
    decoded = decodeCookiePayload(value);
  } catch {
    return null;
  }
  const parts = decoded.split("|");
  if (parts.length !== 3) return null;
  const [email, expRaw, mac] = parts;
  if (!email?.endsWith("@ccpatio.com") || !mac) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await hmacSha256Hex(secret, `${email}|${exp}`);
  if (!timingSafeEqualHex(expected, mac)) return null;
  return { email };
}
