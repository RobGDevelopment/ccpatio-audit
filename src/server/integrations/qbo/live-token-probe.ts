/**
 * Honest QBO token probe for Executive stack health (60s server-side cache).
 * Never fakes Green when Intuit returns invalid_client / invalid_grant.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { getQboBaseUrl, getQboEnvironment, getQboTokenId } from "@/server/integrations/qbo/client";
import {
  createDefaultQboFetchDeps,
  QboAuthError,
  QboRefreshError,
  qboFetchWithRefresh,
} from "@/server/integrations/qbo/token-refresh";
import { parseIntuitOAuthErrorCode } from "@/server/integrations/qbo/oauth";

export type QboLiveProbeResult = {
  ok: boolean;
  status: "Healthy" | "Degraded" | "Action Required";
  detail: string;
  oauthError?: string | null;
  companyName?: string;
  checkedAt: string;
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; result: QboLiveProbeResult } | null = null;

export function clearQboLiveProbeCache(): void {
  cache = null;
}

function reconnectRequired(detail: string, oauthError?: string | null): QboLiveProbeResult {
  return {
    ok: false,
    status: "Action Required",
    detail: oauthError
      ? `Reconnect Required · ${oauthError}`
      : detail.includes("Reconnect")
        ? detail
        : `Reconnect Required · ${detail}`,
    oauthError: oauthError ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function probeLiveQboToken(options?: {
  force?: boolean;
  now?: number;
}): Promise<QboLiveProbeResult> {
  const now = options?.now ?? Date.now();
  if (!options?.force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.result;
  }

  try {
    const qboEnv = getQboEnvironment();
    const targetId = getQboTokenId(qboEnv);
    const [tokenRow] = await getDb()
      .select({
        realm_id: qbo_auth_tokens.realm_id,
        refresh_token: qbo_auth_tokens.refresh_token,
        access_token: qbo_auth_tokens.access_token,
      })
      .from(qbo_auth_tokens)
      .where(eq(qbo_auth_tokens.id, targetId))
      .limit(1);

    if (!tokenRow?.refresh_token) {
      const result = reconnectRequired("No QBO refresh token stored — Reconnect Required.");
      cache = { at: now, result };
      return result;
    }
    if (!tokenRow.realm_id) {
      const result = reconnectRequired("QBO realm missing — Reconnect Required.");
      cache = { at: now, result };
      return result;
    }

    const realmId = tokenRow.realm_id;
    const body = (await qboFetchWithRefresh(
      `/v3/company/${realmId}/companyinfo/${realmId}`,
      { method: "GET" },
      createDefaultQboFetchDeps({
        env: qboEnv,
        targetId,
        baseUrl: getQboBaseUrl(),
      }),
    )) as { CompanyInfo?: { CompanyName?: string } } | null;

    const companyName = body?.CompanyInfo?.CompanyName ?? "QuickBooks Company";
    const result: QboLiveProbeResult = {
      ok: true,
      status: "Healthy",
      detail: `Connected · ${companyName}`,
      companyName,
      checkedAt: new Date().toISOString(),
    };
    cache = { at: now, result };
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "QBO probe failed";
    const oauthError =
      error instanceof QboRefreshError
        ? parseIntuitOAuthErrorCode(msg) ??
          (/invalid_client/i.test(msg)
            ? "invalid_client"
            : /invalid_grant/i.test(msg)
              ? "invalid_grant"
              : null)
        : /invalid_client/i.test(msg)
          ? "invalid_client"
          : /invalid_grant/i.test(msg)
            ? "invalid_grant"
            : null;

    const authFailed =
      error instanceof QboAuthError ||
      oauthError === "invalid_client" ||
      oauthError === "invalid_grant" ||
      /401|auth|refresh|reconnect|invalid_client|invalid_grant/i.test(msg);

    const result = authFailed
      ? reconnectRequired(msg, oauthError)
      : ({
          ok: false,
          status: "Degraded" as const,
          detail: msg,
          oauthError,
          checkedAt: new Date().toISOString(),
        } satisfies QboLiveProbeResult);

    cache = { at: now, result };
    return result;
  }
}
