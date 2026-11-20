import {
  EMBED_AUTH_COOKIE,
  EMBED_TOKEN_HEADER,
  embedCookieIsValid,
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";

export const PRIMEVIEW_PARTNER_TOKEN_HEADER = "x-primeview-partner-token";

export type AssetStudioActor = "ghl_admin" | "primeview_partner";

export type AssetStudioAuthResult =
  | { ok: true; actor: AssetStudioActor }
  | { ok: false; status: 401; reason: string };

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Dual-auth gate for Asset Studio APIs. Accepts EITHER:
 *  - GHL embed: `x-ccpatio-embed-token` header (HMAC session token) or `ccpatio-embed-auth` cookie
 *  - PrimeView partner: `x-primeview-partner-token` header, `?token=` query, or `token` in the JSON body
 * `bodyToken` lets a route pass the already-parsed body token (the body stream is single-use).
 * Failures are always 401 and never reveal which mechanism was close.
 */
export async function authenticateAssetStudioRequest(
  request: Request,
  opts: { bodyToken?: string | null } = {},
): Promise<AssetStudioAuthResult> {
  const secret = getGhlEmbedSecret();
  if (secret) {
    const headerToken = request.headers.get(EMBED_TOKEN_HEADER);
    if (headerToken && (await verifyEmbedSessionToken(headerToken, secret))) {
      return { ok: true, actor: "ghl_admin" };
    }
    const cookieToken = readCookie(request, EMBED_AUTH_COOKIE);
    if (cookieToken && (await embedCookieIsValid(cookieToken, secret))) {
      return { ok: true, actor: "ghl_admin" };
    }
    // The embed provider also mirrors the signed session token into a cookie of the header's name.
    const sessionCookie = readCookie(request, EMBED_TOKEN_HEADER);
    if (sessionCookie && (await verifyEmbedSessionToken(sessionCookie, secret))) {
      return { ok: true, actor: "ghl_admin" };
    }
  }

  let queryToken: string | null = null;
  try {
    queryToken = new URL(request.url).searchParams.get("token");
  } catch {
    queryToken = null;
  }
  const partnerToken =
    request.headers.get(PRIMEVIEW_PARTNER_TOKEN_HEADER) ?? queryToken ?? opts.bodyToken ?? null;
  const partner = authenticatePrimeviewHandoffToken(partnerToken);
  if (partner.ok) return { ok: true, actor: "primeview_partner" };

  return {
    ok: false,
    status: 401,
    reason: "Unauthorized: a valid GHL embed session or PrimeView partner token is required.",
  };
}
