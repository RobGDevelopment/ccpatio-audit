/**
 * Dual embed auth for Route Handlers: accept `x-ccpatio-embed-token` header
 * OR `ccpatio-embed-auth` cookie (GHL often blocks third-party cookies).
 */
import {
  EMBED_AUTH_COOKIE,
  EMBED_TOKEN_HEADER,
  embedCookieIsValid,
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { getPimSession } from "@/lib/pim-audit";

function cookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function authorizeEmbedRequest(request: Request): Promise<boolean> {
  const session = await getPimSession();
  if (session) return true;

  const secret = getGhlEmbedSecret();
  if (!secret) return false;

  const headerToken =
    request.headers.get(EMBED_TOKEN_HEADER) ??
    new URL(request.url).searchParams.get("embedToken");
  if (await verifyEmbedSessionToken(headerToken, secret)) return true;

  const cookieToken = cookieValue(request, EMBED_AUTH_COOKIE);
  if (await embedCookieIsValid(cookieToken, secret)) return true;

  // Client may mirror the HMAC session into a non-httpOnly cookie of the same header name.
  const mirrored = cookieValue(request, EMBED_TOKEN_HEADER);
  if (await verifyEmbedSessionToken(mirrored, secret)) return true;

  return false;
}
