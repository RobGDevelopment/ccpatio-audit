import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { getQboTokenId } from "@/server/integrations/qbo/client";
import {
  fingerprintUpstreamBody,
  getSanitizedQboConfig,
  isAllowedQboRealmId,
  oauthStateMatches,
  parseIntuitOAuthErrorCode,
  prefersQboHtmlCallback,
  QBO_OAUTH_STATE_COOKIE,
  qboCredentialLogMeta,
  sanitizedQboOAuthError,
} from "@/server/integrations/qbo/oauth";
import {
  renderQboOAuthFailureHtml,
  renderQboOAuthSuccessHtml,
} from "@/server/integrations/qbo/oauth-callback-html";

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

function htmlOrJson(
  req: Request,
  opts: {
    status: number;
    json: Record<string, unknown>;
    html: string;
    secure: boolean;
  },
): NextResponse {
  const res = prefersQboHtmlCallback(req)
    ? new NextResponse(opts.html, {
        status: opts.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      })
    : NextResponse.json(opts.json, { status: opts.status });
  clearStateCookie(res, opts.secure);
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const secure = url.protocol === "https:";
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const config = getSanitizedQboConfig(process.env, origin);

  const jar = await cookies();
  const cookieState = jar.get(QBO_OAUTH_STATE_COOKIE)?.value ?? null;
  const embedKey = (jar.get("qbo_oauth_embed_key")?.value ?? "").trim();
  const returnHref = embedKey
    ? `/embed/admin/master-catalog?key=${encodeURIComponent(embedKey)}`
    : "/embed/admin/master-catalog";

  if (!oauthStateMatches(state, cookieState)) {
    console.error("[QBO OAUTH] state mismatch or missing cookie");
    return htmlOrJson(req, {
      status: 403,
      secure,
      json: sanitizedQboOAuthError("state_mismatch", "Invalid OAuth state"),
      html: renderQboOAuthFailureHtml({
        oauthError: "state_mismatch",
        message:
          "OAuth state mismatch — the login session cookie did not match Intuit’s callback. Close this window and try Reconnect again.",
        config,
        returnHref,
      }),
    });
  }

  if (!code || !realmId) {
    return htmlOrJson(req, {
      status: 400,
      secure,
      json: sanitizedQboOAuthError("missing_params", "Missing code or realmId"),
      html: renderQboOAuthFailureHtml({
        oauthError: "missing_params",
        message: "Intuit did not return an authorization code or realmId.",
        config,
        returnHref,
      }),
    });
  }

  if (!isAllowedQboRealmId(realmId)) {
    console.error("[QBO OAUTH] realmId rejected by QBO_EXPECTED_REALM_ID", {
      realmIdFingerprint: fingerprintUpstreamBody(realmId),
    });
    return htmlOrJson(req, {
      status: 403,
      secure,
      json: sanitizedQboOAuthError("realm_rejected", "Realm not allowed for this environment"),
      html: renderQboOAuthFailureHtml({
        oauthError: "realm_rejected",
        message: "This QuickBooks company (realm) is not allowed for this environment.",
        config,
        returnHref,
      }),
    });
  }

  const { clientId, clientSecret, redirectUri } = config;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[QBO OAUTH] Missing QBO env after trim", {
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      hasRedirectUri: Boolean(redirectUri),
    });
    return htmlOrJson(req, {
      status: 500,
      secure,
      json: sanitizedQboOAuthError("misconfigured", "Missing QBO environment variables"),
      html: renderQboOAuthFailureHtml({
        oauthError: "misconfigured",
        message: "QBO Client ID, Client Secret, or Redirect URI is missing after sanitization.",
        config,
        returnHref,
      }),
    });
  }

  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
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
    const oauthError = parseIntuitOAuthErrorCode(errText);
    console.error("[QBO OAUTH] Failed to exchange token:", {
      status: tokenRes.status,
      oauthError,
      bodyFingerprint: fingerprintUpstreamBody(errText),
      bodyLength: errText.length,
      ...qboCredentialLogMeta({ clientId, clientSecret, redirectUri }),
    });
    return htmlOrJson(req, {
      status: 500,
      secure,
      json: sanitizedQboOAuthError("token_exchange_failed", "Token exchange failed", {
        oauth_error: oauthError,
      }),
      html: renderQboOAuthFailureHtml({
        oauthError: oauthError ?? "token_exchange_failed",
        message:
          "Intuit rejected the token exchange (often invalid_client from whitespace/quotes on Client ID/Secret, or a redirect_uri mismatch).",
        config,
        returnHref,
      }),
    });
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in) {
    console.error("[QBO OAUTH] Token response missing fields");
    return htmlOrJson(req, {
      status: 500,
      secure,
      json: sanitizedQboOAuthError("token_incomplete", "Token exchange failed"),
      html: renderQboOAuthFailureHtml({
        oauthError: "token_incomplete",
        message: "Intuit returned an incomplete token payload.",
        config,
        returnHref,
      }),
    });
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  const targetId = getQboTokenId(config.environment);

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

  return htmlOrJson(req, {
    status: 200,
    secure,
    json: { success: true, message: "QBO OAuth Successful" },
    html: renderQboOAuthSuccessHtml({ returnHref }),
  });
}
