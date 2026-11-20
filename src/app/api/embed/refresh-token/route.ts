/**
 * POST /api/embed/refresh-token
 * Silent GHL embed session renewal: accepts a currently-valid
 * `x-ccpatio-embed-token` header OR `ccpatio-embed-auth` cookie and returns a
 * fresh 2-hour HMAC token so Mia never hits 401 after leaving GHL open.
 */
import { NextResponse } from "next/server";
import {
  EMBED_AUTH_COOKIE,
  EMBED_TOKEN_HEADER,
  embedCookieIsValid,
  embedTokenTtlSeconds,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = getGhlEmbedSecret();
  if (!secret) {
    return NextResponse.json({ error: "embed_secret_missing" }, { status: 503 });
  }

  const headerToken = request.headers.get(EMBED_TOKEN_HEADER);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${EMBED_AUTH_COOKIE}=([^;]+)`),
  );
  const cookieToken = cookieMatch?.[1]
    ? decodeURIComponent(cookieMatch[1])
    : undefined;

  const headerOk = Boolean(await verifyEmbedSessionToken(headerToken, secret));
  const cookieOk = Boolean(await embedCookieIsValid(cookieToken, secret));
  if (!headerOk && !cookieOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await mintEmbedSessionToken(secret);
  return NextResponse.json({
    ok: true,
    token,
    expiresIn: embedTokenTtlSeconds(),
    header: EMBED_TOKEN_HEADER,
  });
}
