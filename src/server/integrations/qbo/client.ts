import { getDb, getMutexDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";

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
 * Automatically checks token expiration and uses a Postgres Advisory Lock 
 * to ensure that only one Inngest worker executes the refresh flow at a time.
 */
async function qboFetch(endpoint: string, options: RequestInit = {}) {
  // Dedicated max:1 connection (transaction pooler 6543 or direct, see resolveMutexConnection).
  // pg_advisory_xact_lock below must not run on the shared pool or on Supavisor session mode (5432).
  const db = getMutexDb();
  const qboEnv = getQboEnvironment();
  const targetId = getQboTokenId(qboEnv);

  let [tokenRow] = await db
    .select()
    .from(qbo_auth_tokens)
    .where(eq(qbo_auth_tokens.id, targetId));

  // Graceful fallback: if sandbox row is not yet initialized at id=false,
  // fall back to legacy singleton row (id=true).
  if (!tokenRow && !targetId) {
    const [legacyRow] = await db
      .select()
      .from(qbo_auth_tokens)
      .where(eq(qbo_auth_tokens.id, true));
    tokenRow = legacyRow;
  }

  if (!tokenRow) {
    throw new Error(`No QBO auth tokens found for environment "${qboEnv}". Please complete OAuth flow first.`);
  }

  const isExpired = (row: typeof tokenRow) => 
    row.expires_at && row.expires_at.getTime() - Date.now() < 5 * 60 * 1000;

  // The Advisory Lock (Crucial for high concurrency webhooks)
  if (isExpired(tokenRow)) {
    await db.transaction(async (tx) => {
      // 1. Acquire transaction-level advisory lock (ID 987654321)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(987654321);`);
      
      // 2. Re-query the environment row to see if another thread already refreshed it while we were waiting
      const [lockedTokenRow] = await tx
        .select()
        .from(qbo_auth_tokens)
        .where(eq(qbo_auth_tokens.id, tokenRow.id));
      tokenRow = lockedTokenRow;

      if (!tokenRow) {
        throw new Error("No QBO auth tokens found during lock escalation.");
      }

      // 3. Evaluate if we STILL need to refresh
      if (isExpired(tokenRow)) {
        console.log(`[QBO] Token expired for ${qboEnv}. Executing refresh flow.`);
        const clientId = process.env.QBO_CLIENT_ID!;
        const clientSecret = process.env.QBO_CLIENT_SECRET!;
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        const refreshRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenRow.refresh_token!,
          }),
        });

        if (!refreshRes.ok) {
          const errBody = await refreshRes.text();
          throw new Error(`Failed to refresh QBO token: ${errBody}`);
        }

        const refreshData = await refreshRes.json();
        const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000);

        // 4. Update the stored token for this environment row
        const [updated] = await tx.update(qbo_auth_tokens)
          .set({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || tokenRow.refresh_token,
            expires_at: newExpiresAt,
          })
          .where(eq(qbo_auth_tokens.id, tokenRow.id))
          .returning();

        tokenRow = updated;
      }
      
      // 5. Transaction commits, automatically releasing the PG lock
    });
  }

  // Derive Base URL strictly from QBO_ENVIRONMENT, decoupled from NODE_ENV
  const baseUrl = getQboBaseUrl();

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${tokenRow.access_token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QBO Fetch Failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json();
}

export async function pushToQBO(salesReceiptPayload: any) {
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

