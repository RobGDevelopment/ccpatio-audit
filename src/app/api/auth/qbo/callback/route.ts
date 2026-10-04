import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");

  if (!code || !realmId) {
    return NextResponse.json({ error: "Missing code or realmId" }, { status: 400 });
  }

  const clientId = process.env.QBO_CLIENT_ID?.trim().replace(/^["']|["']$/g, "");
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim().replace(/^["']|["']$/g, "");
  const redirectUri = process.env.QBO_OAUTH_REDIRECT_URI?.trim().replace(/^["']|["']$/g, "");

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Missing QBO environment variables" }, { status: 500 });
  }

  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
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
    const err = await tokenRes.text();
    console.error("[QBO OAUTH] Failed to exchange token:", err);
    return NextResponse.json({ error: "Token exchange failed", details: err }, { status: 500 });
  }

  const tokenData = await tokenRes.json();
  const db = getDb();

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // Upsert the tokens for our singleton row
  await db
    .insert(qbo_auth_tokens)
    .values({
      id: true,
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

  return NextResponse.json({ success: true, message: "QBO OAuth Successful" }, { status: 200 });
}
