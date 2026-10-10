"use server";

import { createClient } from "@/utils/supabase/server";
import { fetchFailedPublishJobs, replayInngestRun } from "@/services/inngest-api";
import { invalidateVendorKey } from "@/utils/vault";
import { getDb } from "@/server/db/client";
import { vendor_credentials } from "@/server/db/schema";
import {
  MissionControlUnauthorizedError,
  requireMissionControlRole,
  type MissionControlRole,
} from "@/server/mission-control/require-role";

export type MissionControlSession = {
  id: string;
  email: string | null;
  role: MissionControlRole;
};

/**
 * Session gate for Mission Control. The role decision lives in requireMissionControlRole.
 */
export async function requireMissionControlAuth(): Promise<MissionControlSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new MissionControlUnauthorizedError("NO_SESSION", "Unauthorized: No active session.");
  }

  const role = await requireMissionControlRole(user.id, user.email);
  return { id: user.id, email: user.email ?? null, role };
}

export async function getFailedJobsAction() {
  await requireMissionControlAuth();
  
  try {
    const jobs = await fetchFailedPublishJobs();
    return { ok: true, data: jobs };
  } catch (error: any) {
    return { ok: false, error: error.message || "Failed to fetch jobs" };
  }
}

export async function retryJobAction(runId: string) {
  await requireMissionControlAuth();

  try {
    const result = await replayInngestRun(runId);
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, error: error.message || "Failed to replay job" };
  }
}

type VendorService = "katana" | "woocommerce" | "clover";

export async function testVendorKeyAction(serviceName: VendorService, testKey: string) {
  await requireMissionControlAuth();

  try {
    if (serviceName === "katana") {
      const response = await fetch("https://api.katanamrp.com/v1/products?limit=1", {
        headers: { Authorization: `Bearer ${testKey}` },
      });
      if (!response.ok) return { ok: false, error: `Katana returned ${response.status}` };
    } else if (serviceName === "woocommerce") {
      const baseUrl = process.env.WOOCOMMERCE_URL?.trim().replace(/\/$/, "");
      if (!baseUrl) return { ok: false, error: "WOOCOMMERCE_URL not set" };
      const auth = testKey.includes(":") ? Buffer.from(testKey).toString("base64") : testKey;
      const response = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=1`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!response.ok) return { ok: false, error: `WooCommerce returned ${response.status}` };
    } else if (serviceName === "clover") {
      const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
      const base = process.env.CLOVER_API_BASE?.trim().replace(/\/$/, "") || "https://api.clover.com";
      if (!merchantId) return { ok: false, error: "CLOVER_MERCHANT_ID not set" };
      const response = await fetch(`${base}/v3/merchants/${merchantId}/items?limit=1`, {
        headers: { Authorization: `Bearer ${testKey}` },
      });
      if (!response.ok) return { ok: false, error: `Clover returned ${response.status}` };
    }

    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message || "Network error during test" };
  }
}

export async function saveVendorKeyAction(serviceName: VendorService, newKey: string) {
  const user = await requireMissionControlAuth();

  try {
    const db = getDb();
    
    // Note: When fully wired with pgsodium, we might insert/update differently
    // to utilize the pgsodium encryption function. For now, we update the encrypted_token column directly.
    await db
      .insert(vendor_credentials)
      .values({
        service_name: serviceName,
        encrypted_token: newKey,
        updated_by: user.id,
      })
      .onConflictDoUpdate({
        target: vendor_credentials.service_name,
        set: {
          encrypted_token: newKey,
          updated_by: user.id,
          updated_at: new Date(),
        },
      });

    // Invalidate the cache so the new key is used immediately
    invalidateVendorKey(serviceName);

    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message || "Failed to save vendor key" };
  }
}
