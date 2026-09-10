import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getDecryptedVendorKey } from "@/utils/vault";

export type SpokeName = "WordPressCore" | "Katana" | "WooCommerce" | "Clover";

export type SpokePingResult = {
  spoke: SpokeName;
  ok: boolean;
  status: number | null;
  authFailed: boolean;
  detail: string;
};

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

async function pingWordPressCore(): Promise<SpokePingResult> {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    return {
      spoke: "WordPressCore",
      ok: false,
      status: null,
      authFailed: false,
      detail: "WOOCOMMERCE_URL is not set",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/wp-json/`, {
      method: "GET",
    });
    return {
      spoke: "WordPressCore",
      ok: response.ok,
      status: response.status,
      authFailed: false,
      detail: response.ok ? "ok" : `WordPress HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      spoke: "WordPressCore",
      ok: false,
      status: null,
      authFailed: false,
      detail: error instanceof Error ? error.message : "WP network error",
    };
  }
}

async function pingKatana(): Promise<SpokePingResult> {
  const token = await getDecryptedVendorKey("katana");
  if (!token) {
    return {
      spoke: "Katana",
      ok: false,
      status: null,
      authFailed: true,
      detail: "Katana API token is missing in Vault",
    };
  }

  try {
    const response = await fetch(
      "https://api.katanamrp.com/v1/products?limit=1",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    const authFailed = isAuthFailure(response.status);
    return {
      spoke: "Katana",
      ok: response.ok,
      status: response.status,
      authFailed,
      detail: authFailed
        ? `Katana returned HTTP ${response.status} — token expired or revoked`
        : response.ok
          ? "ok"
          : `Katana HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      spoke: "Katana",
      ok: false,
      status: null,
      authFailed: false,
      detail: error instanceof Error ? error.message : "Katana network error",
    };
  }
}

async function pingWooCommerce(): Promise<SpokePingResult> {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim().replace(/\/$/, "");
  const token = await getDecryptedVendorKey("woocommerce");
  if (!baseUrl || !token) {
    return {
      spoke: "WooCommerce",
      ok: false,
      status: null,
      authFailed: true,
      detail: "WOOCOMMERCE_URL or Woo token missing",
    };
  }

  try {
    // If the user stored `key:secret`, base64 encode it. Otherwise, assume it's already encoded.
    const auth = token.includes(":") ? Buffer.from(token).toString("base64") : token;
    
    const response = await fetch(
      `${baseUrl}/wp-json/wc/v3/products?per_page=1`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
    );
    const authFailed = isAuthFailure(response.status);
    return {
      spoke: "WooCommerce",
      ok: response.ok,
      status: response.status,
      authFailed,
      detail: authFailed
        ? `WooCommerce returned HTTP ${response.status} — token expired or revoked`
        : response.ok
          ? "ok"
          : `WooCommerce HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      spoke: "WooCommerce",
      ok: false,
      status: null,
      authFailed: false,
      detail:
        error instanceof Error ? error.message : "WooCommerce network error",
    };
  }
}

async function pingClover(): Promise<SpokePingResult> {
  const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
  const token = await getDecryptedVendorKey("clover");
  if (!merchantId || !token) {
    return {
      spoke: "Clover",
      ok: false,
      status: null,
      authFailed: true,
      detail: "CLOVER_MERCHANT_ID or Clover token missing",
    };
  }

  try {
    const base =
      process.env.CLOVER_API_BASE?.trim().replace(/\/$/, "") ||
      "https://api.clover.com";
    const response = await fetch(
      `${base}/v3/merchants/${merchantId}/items?limit=1`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    const authFailed = isAuthFailure(response.status);
    return {
      spoke: "Clover",
      ok: response.ok,
      status: response.status,
      authFailed,
      detail: authFailed
        ? `Clover returned HTTP ${response.status} — API token expired or revoked`
        : response.ok
          ? "ok"
          : `Clover HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      spoke: "Clover",
      ok: false,
      status: null,
      authFailed: false,
      detail: error instanceof Error ? error.message : "Clover network error",
    };
  }
}

export async function runSpokeTokenHealthCheck(silent = false): Promise<{
  ok: boolean;
  results: SpokePingResult[];
  alerted: SpokeName[];
}> {
  const results = await Promise.all([
    pingWordPressCore(),
    pingKatana(),
    pingWooCommerce(),
    pingClover(),
  ]);

  const alerted: SpokeName[] = [];
  
  if (!silent) {
    for (const result of results) {
      if (result.spoke === "WordPressCore" && (!result.ok || (result.status && result.status >= 500) || result.status === null)) {
        alerted.push(result.spoke);
        await sendOhCrapAlert({
          reason: "unknown",
          source: "system",
          externalId: "wp-core-offline",
          message: "URGENT: The core WordPress server is offline or unreachable. WooCommerce syncs will fail.",
          resolutionPath: "/admin/quarantine",
        });
      } else if (result.authFailed) {
        alerted.push(result.spoke);
        await sendOhCrapAlert({
          reason: "unknown",
          source: "system",
          externalId: `token-health-${result.spoke.toLowerCase()}`,
          message: `TOKEN EXPIRED: The API key for ${result.spoke} has expired. Please log into the CC Patio Mission Control dashboard to rotate the key.`,
          resolutionPath: "/admin/quarantine",
        });
      }
    }
  }

  // Gracefully fail if alerts were sent so it triggers DLQ in Inngest
  if (alerted.length > 0 && !silent) {
    throw new Error(`Health check failed for: ${alerted.join(", ")}`);
  }

  return {
    ok: results.every((r) => r.ok),
    results,
    alerted,
  };
}
