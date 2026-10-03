import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Executes a fetch against the Intuit Quickbooks Online API.
 * Automatically checks token expiration and uses a Postgres Advisory Lock 
 * to ensure that only one Inngest worker executes the refresh flow at a time.
 */
async function qboFetch(endpoint: string, options: RequestInit = {}) {
  const db = getDb();
  let [tokenRow] = await db.select().from(qbo_auth_tokens).where(eq(qbo_auth_tokens.id, true));

  if (!tokenRow) {
    throw new Error("No QBO auth tokens found. Please complete OAuth flow first.");
  }

  const isExpired = (row: typeof tokenRow) => 
    row.expires_at && row.expires_at.getTime() - Date.now() < 5 * 60 * 1000;

  // The Advisory Lock (Crucial for high concurrency webhooks)
  if (isExpired(tokenRow)) {
    await db.transaction(async (tx) => {
      // 1. Acquire transaction-level advisory lock (ID 987654321)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(987654321);`);
      
      // 2. Re-query to see if another thread already refreshed it while we were waiting
      const [lockedTokenRow] = await tx.select().from(qbo_auth_tokens).where(eq(qbo_auth_tokens.id, true));
      tokenRow = lockedTokenRow;

      if (!tokenRow) {
        throw new Error("No QBO auth tokens found during lock escalation.");
      }

      // 3. Evaluate if we STILL need to refresh
      if (isExpired(tokenRow)) {
        console.log("[QBO] Token expired. Executing refresh flow.");
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

        // 4. Update the stored token
        const [updated] = await tx.update(qbo_auth_tokens)
          .set({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || tokenRow.refresh_token,
            expires_at: newExpiresAt,
          })
          .where(eq(qbo_auth_tokens.id, true))
          .returning();

        tokenRow = updated;
      }
      
      // 5. Transaction commits, automatically releasing the PG lock
    });
  }

  // Derive Base URL depending on environment
  const baseUrl = process.env.QBO_API_URL || 
    (process.env.NODE_ENV === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");

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
  const [tokenRow] = await db.select({ realm_id: qbo_auth_tokens.realm_id })
    .from(qbo_auth_tokens)
    .where(eq(qbo_auth_tokens.id, true));

  if (!tokenRow?.realm_id) {
    throw new Error("Missing QBO Realm ID in database");
  }

  const endpoint = `/v3/company/${tokenRow.realm_id}/salesreceipt`;

  console.log(`[QBO] Pushing sales receipt to ${endpoint}`);
  
  return await qboFetch(endpoint, {
    method: "POST",
    body: JSON.stringify(salesReceiptPayload),
  });
}
