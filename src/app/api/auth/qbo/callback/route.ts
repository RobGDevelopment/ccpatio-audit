import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { getQboTokenId } from "@/server/integrations/qbo/client";
import {
  fingerprintUpstreamBody,
  isAllowedQboRealmId,
  oauthStateMatches,
  QBO_OAUTH_STATE_COOKIE,
  sanitizedQboOAuthError,
  stripEnvQuotes,
} from "@/server/integrations/qbo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearStateCookie(res: NextResponse, secure: boolean) {
  res.cookies.set(QBO_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const cookieState = jar.get(QBO_OAUTH_STATE_COOKIE)?.value ?? null;

  if (!oauthStateMatches(state, cookieState)) {
    console.error("[QBO OAUTH] state mismatch or missing cookie");
    const res = NextResponse.json(
      sanitizedQboOAuthError("state_mismatch", "Invalid OAuth state"),
      { status: 403 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  if (!code || !realmId) {
    const res = NextResponse.json(
      sanitizedQboOAuthError("missing_params", "Missing code or realmId"),
      { status: 400 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  if (!isAllowedQboRealmId(realmId)) {
    console.error("[QBO OAUTH] realmId rejected by QBO_EXPECTED_REALM_ID", {
      realmIdFingerprint: fingerprintUpstreamBody(realmId),
    });
    const res = NextResponse.json(
      sanitizedQboOAuthError("realm_rejected", "Realm not allowed for this environment"),
      { status: 403 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  const clientId = stripEnvQuotes(process.env.QBO_CLIENT_ID);
  const clientSecret = stripEnvQuotes(process.env.QBO_CLIENT_SECRET);
  const redirectUri = stripEnvQuotes(process.env.QBO_OAUTH_REDIRECT_URI);

  if (!clientId || !clientSecret || !redirectUri) {
    const res = NextResponse.json(
      sanitizedQboOAuthError("misconfigured", "Missing QBO environment variables"),
      { status: 500 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader,
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[QBO OAUTH] Failed to exchange token:", {
      status: tokenRes.status,
      bodyFingerprint: fingerprintUpstreamBody(errText),
      bodyLength: errText.length,
    });
    const res = NextResponse.json(
      sanitizedQboOAuthError("token_exchange_failed", "Token exchange failed"),
      { status: 500 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in) {
    console.error("[QBO OAUTH] Token response missing fields");
    const res = NextResponse.json(
      sanitizedQboOAuthError("token_incomplete", "Token exchange failed"),
      { status: 500 },
    );
    clearStateCookie(res, secure);
    return res;
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  const targetId = getQboTokenId();

  await db
    .insert(qbo_auth_tokens)
    .values({
      id: targetId,
      realm_id: realmId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
    })
    .onConflictDoUpdate({
      target: qbo_auth_tokens.id,
      set: {
        realm_id: realmId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
      },
    });

  const res = NextResponse.json(
    { success: true, message: "QBO OAuth Successful" },
    { status: 200 },
  );
  clearStateCookie(res, secure);
  return res;
}
