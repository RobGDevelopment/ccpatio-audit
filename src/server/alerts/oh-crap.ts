/**
 * Oh-Crap protocol — wired into Inngest onFailure + validation/Katana catch paths.
 *
 * Failure path: autonomous rule fails → email ops admin → deep link to
 * Next.js resolution UI (`/admin/dictionary?sku=…`).
 */

export type OhCrapReason =
  | "sku_not_in_dictionary"
  | "sku_not_in_katana"
  | "validation_failed"
  | "katana_rejected"
  | "missing_line_items"
  | "unknown";

export type OhCrapAlertInput = {
  reason: OhCrapReason;
  source: "ghl" | "woocommerce" | "katana" | "system";
  externalId: string;
  sku?: string;
  message: string;
  rawPayload?: unknown;
  /** Absolute or path-only URL to admin resolution UI */
  resolutionPath?: string;
};

export type OhCrapAlertResult =
  | { ok: true; emailed: boolean; resolutionUrl: string }
  | { ok: false; error: string };

function resolveAdminEmail(): string | null {
  return (
    process.env.OH_CRAP_ADMIN_EMAIL?.trim() ||
    process.env.ADMIN_ALERT_EMAIL?.trim() ||
    null
  );
}

function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim().replace(/^/, "https://") ||
    "http://localhost:3000"
  );
}

export function buildResolutionUrl(input: OhCrapAlertInput): string {
  const base = resolveAppBaseUrl().replace(/\/$/, "");
  if (input.resolutionPath?.startsWith("http")) {
    return input.resolutionPath;
  }
  if (input.resolutionPath) {
    return `${base}${input.resolutionPath.startsWith("/") ? "" : "/"}${input.resolutionPath}`;
  }

  const params = new URLSearchParams({
    source: input.source,
    externalId: input.externalId,
    reason: input.reason,
  });
  if (input.sku) {
    params.set("sku", input.sku);
  }
  return `${base}/admin/dictionary?${params.toString()}`;
}

function formatEmailBody(input: OhCrapAlertInput, resolutionUrl: string): string {
  return [
    "OH CRAP — Autonomous ERP rule failed",
    "",
    `Reason: ${input.reason}`,
    `Source: ${input.source}`,
    `External ID: ${input.externalId}`,
    input.sku ? `SKU: ${input.sku}` : null,
    `Message: ${input.message}`,
    "",
    "Resolve here (open dictionary / quarantine UI):",
    resolutionUrl,
    "",
    "Do not invent SKUs. Fix the dictionary or correct the GHL payload, then replay.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Send ops alert. Uses Resend if RESEND_API_KEY is set; otherwise logs loudly
 * (Crawl-safe — never silently swallows).
 */
export async function sendOhCrapAlert(
  input: OhCrapAlertInput,
): Promise<OhCrapAlertResult> {
  const adminEmail = resolveAdminEmail();
  const resolutionUrl = buildResolutionUrl(input);
  const subject = `[CC Patio Oh-Crap] ${input.reason} · ${input.externalId}`;
  const body = formatEmailBody(input, resolutionUrl);

  console.error("[oh-crap]", {
    reason: input.reason,
    source: input.source,
    externalId: input.externalId,
    sku: input.sku,
    message: input.message,
    resolutionUrl,
  });

  if (!adminEmail) {
    return {
      ok: false,
      error:
        "OH_CRAP_ADMIN_EMAIL (or ADMIN_ALERT_EMAIL) is not set — alert logged only.",
    };
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.error("[oh-crap] RESEND_API_KEY missing — email not sent.", {
      adminEmail,
      subject,
      body,
    });
    return { ok: true, emailed: false, resolutionUrl };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          process.env.OH_CRAP_FROM_EMAIL?.trim() ||
          "CC Patio Middleware <onboarding@resend.dev>",
        to: [adminEmail],
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        error: `Resend failed (${response.status}): ${detail.slice(0, 500)}`,
      };
    }

    return { ok: true, emailed: true, resolutionUrl };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send Oh-Crap email";
    return { ok: false, error: message };
  }
}

/**
 * Example Inngest failure hook (Priority 3 wiring):
 *
 *   export const syncGhlOpportunity = inngest.createFunction(
 *     {
 *       id: "sync-ghl-opportunity",
 *       triggers: [{ event: "ghl/opportunity.sync" }],
 *       onFailure: async ({ error, event }) => {
 *         await sendOhCrapAlert({
 *           reason: "unknown",
 *           source: "ghl",
 *           externalId: String(event.data.event?.data?.id ?? "unknown"),
 *           message: error.message,
 *           rawPayload: event.data,
 *         });
 *       },
 *     },
 *     async ({ event, step }) => { ... },
 *   );
 */
