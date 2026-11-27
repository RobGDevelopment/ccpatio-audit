import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { getDb } from "@/server/db/client";
import { user_roles } from "@/server/db/schema";
import {
  buildQboAuthorizeUrl,
  canInitiateQboOAuth,
  getSanitizedQboConfig,
  isValidQboConnectSecret,
  mintQboOAuthState,
  QBO_OAUTH_STATE_COOKIE,
  qboOAuthStateCookieOptions,
  sanitizedQboOAuthError,
} from "@/server/integrations/qbo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function hasMissionControlQboSession(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return false;
    const db = getDb();
    const [row] = await db
      .select({ role: user_roles.role })
      .from(user_roles)
      .where(eq(user_roles.id, user.id))
      .limit(1);
    return canInitiateQboOAuth(row?.role);
  } catch {
    return false;
  }
}

/**
 * OAuth initiation — SuperAdmin / IT_Admin session OR `QBO_CONNECT_SECRET`
 * (header `x-qbo-connect-secret` or query `secret`).
 * Sets HttpOnly SameSite=Lax `qbo_oauth_state` then redirects to Intuit.
 * Uses the same sanitized redirect_uri as `/api/auth/qbo/callback`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret =
    req.headers.get("x-qbo-connect-secret") ?? url.searchParams.get("secret");

  const authorized =
    isValidQboConnectSecret(secret) || (await hasMissionControlQboSession());
  if (!authorized) {
    return NextResponse.json(
      sanitizedQboOAuthError(
        "unauthorized",
        "QBO connect requires SuperAdmin, IT_Admin, or connect secret",
      ),
      { status: 403 },
    );
  }

  const config = getSanitizedQboConfig(process.env, url.origin);
  if (!config.clientId || !config.redirectUri) {
    return NextResponse.json(
      sanitizedQboOAuthError("misconfigured", "Missing QBO OAuth configuration"),
      { status: 500 },
    );
  }

  const state = mintQboOAuthState();
  const authorizeUrl = buildQboAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
  const secure = url.protocol === "https:";

  const res = NextResponse.redirect(authorizeUrl, 302);
  res.cookies.set(QBO_OAUTH_STATE_COOKIE, state, qboOAuthStateCookieOptions(secure));
  return res;
}
