/**
 * Signed HTTP-only session cookie for @ccpatio.com PIM operators.
 * Edge-safe (Web Crypto) for Next.js middleware.
 */

export const PIM_SESSION_COOKIE = "pim_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type PimSession = {
  email: string;
  name: string;
  exp: number;
};

export function isCcpatioEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === "rjg.cal@gmail.com") return true;
  return /^[^\s@]+@ccpatio\.com$/.test(normalized);
}

function sessionSecret(): string {
  const secret = process.env.PIM_SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PIM_SESSION_SECRET is required in production");
  }
  return "dev-only-pim-session-secret-change-me";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toBase64Url(new Uint8Array(sig));
}

async function hmacVerify(payload: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(payload);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function signPimSession(
  email: string,
  name: string,
): Promise<string> {
  const payload: PimSession = {
    email: email.trim().toLowerCase(),
    name: name.trim(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body);
  return `${body}.${sig}`;
}

export async function verifyPimSessionToken(
  token: string | undefined | null,
): Promise<PimSession | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const valid = await hmacVerify(body, sig);
  if (!valid) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const parsed = JSON.parse(json) as PimSession;
    if (!parsed.email || !parsed.name || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    if (!isCcpatioEmail(parsed.email)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pimSessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}
