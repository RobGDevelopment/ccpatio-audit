import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getLedgerPipelineMode } from "@/server/pipeline/ledger-mode";
import { createDefaultQboFetchDeps, qboFetchWithRefresh } from "./token-refresh";

export type QboEnvironment = "sandbox" | "production";

/**
 * Returns the active QBO environment strictly from QBO_ENVIRONMENT,
 * completely decoupled from NODE_ENV.
 */
export function getQboEnvironment(): QboEnvironment {
  const envVal = process.env.QBO_ENVIRONMENT?.trim().toLowerCase();
  return envVal === "production" ? "production" : "sandbox";
}

/**
 * Maps QBO_ENVIRONMENT to the correct Intuit API base URL.
 * Never checks NODE_ENV.
 */
export function getQboBaseUrl(): string {
  if (process.env.QBO_API_URL?.trim()) {
    return process.env.QBO_API_URL.trim().replace(/\/$/, "");
  }
  return getQboEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/**
 * Maps the QBO environment to the corresponding row ID in qbo_auth_tokens.
 * production -> true
 * sandbox -> false
 */
export function getQboTokenId(env: QboEnvironment = getQboEnvironment()): boolean {
  return env === "production";
}

/**
 * Executes a fetch against the Intuit Quickbooks Online API.
 * Token refresh is serialized per environment with a Postgres advisory lock and is
 * double-checked, see ./token-refresh.ts (Phase 9 Task 4).
 */
async function qboFetch(endpoint: string, options: RequestInit = {}) {
  const qboEnv = getQboEnvironment();
  return qboFetchWithRefresh(
    endpoint,
    options,
    createDefaultQboFetchDeps({
      env: qboEnv,
      targetId: getQboTokenId(qboEnv),
      // Derive Base URL strictly from QBO_ENVIRONMENT, decoupled from NODE_ENV
      baseUrl: getQboBaseUrl(),
    }),
  );
}

export async function pushToQBO(salesReceiptPayload: any) {
  // Defense in depth (Phase 9 Task 0): even if a caller forgets the gate, the ledger
  // POST itself refuses to run unless LEDGER_PIPELINE_MODE is explicitly "live".
  const ledgerMode = getLedgerPipelineMode();
  if (ledgerMode !== "live") {
    throw new Error(
      `LEDGER_PIPELINE_MODE=${ledgerMode}: refusing to POST to QuickBooks (fail-closed ledger containment).`,
    );
  }

  // Map strictly to the clearing account configuration
  salesReceiptPayload.DepositToAccountRef = {
    value: process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID,
  };

  const db = getDb();
  const qboEnv = getQboEnvironment();
  const targetId = getQboTokenId(qboEnv);

  let [tokenRow] = await db
    .select({ realm_id: qbo_auth_tokens.realm_id })
    .from(qbo_auth_tokens)
    .where(eq(qbo_auth_tokens.id, targetId));

  if (!tokenRow?.realm_id && !targetId) {
    const [legacyRow] = await db
      .select({ realm_id: qbo_auth_tokens.realm_id })
      .from(qbo_auth_tokens)
      .where(eq(qbo_auth_tokens.id, true));
    tokenRow = legacyRow;
  }

  if (!tokenRow?.realm_id) {
    throw new Error(`Missing QBO Realm ID for environment "${qboEnv}" in database`);
  }

  const endpoint = `/v3/company/${tokenRow.realm_id}/salesreceipt`;

  console.log(`[QBO] Pushing sales receipt to ${endpoint}`);
  
  return await qboFetch(endpoint, {
    method: "POST",
    body: JSON.stringify(salesReceiptPayload),
  });
}

