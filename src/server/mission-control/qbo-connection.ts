/**
 * Read-only QuickBooks connection panel for Mission Control.
 * Uses the active QBO_ENVIRONMENT token row only (production => id=true).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  getQboEnvironment,
  getQboTokenId,
  type QboEnvironment,
} from "@/server/integrations/qbo/client";
import { qbo_auth_tokens } from "@/server/db/schema";

export type QboConnectionStatus = "Connected" | "Expired" | "Disconnected";

export type QboConnectionPanel = {
  environment: QboEnvironment;
  status: QboConnectionStatus;
  realmId: string | null;
  expiresAt: string | null;
  hasRefreshToken: boolean;
  reconnectPath: "/api/auth/qbo/connect";
};

export function deriveQboConnectionStatus(input: {
  hasRefreshToken: boolean;
  expiresAt: Date | null;
  now?: Date;
}): QboConnectionStatus {
  if (!input.hasRefreshToken) return "Disconnected";
  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    return "Expired";
  }
  return "Connected";
}

export async function readQboConnectionPanel(
  now: Date = new Date(),
): Promise<QboConnectionPanel> {
  const environment = getQboEnvironment();
  const targetId = getQboTokenId(environment);
  const db = getDb();
  const [row] = await db
    .select({
      realmId: qbo_auth_tokens.realm_id,
      expiresAt: qbo_auth_tokens.expires_at,
      refreshToken: qbo_auth_tokens.refresh_token,
    })
    .from(qbo_auth_tokens)
    .where(eq(qbo_auth_tokens.id, targetId))
    .limit(1);

  const hasRefreshToken = Boolean(row?.refreshToken && row.refreshToken.length > 0);
  const expiresAt = row?.expiresAt ?? null;
  const realmId =
    typeof row?.realmId === "string" && row.realmId.trim()
      ? row.realmId.trim()
      : null;

  return {
    environment,
    status: deriveQboConnectionStatus({ hasRefreshToken, expiresAt, now }),
    realmId,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    hasRefreshToken,
    reconnectPath: "/api/auth/qbo/connect",
  };
}
