import { createHmac } from "node:crypto";
import { getGhlEmbedSecret, timingSafeEqualString } from "@/lib/embed-auth";

export const PRIMEVIEW_HANDOFF_TOKEN_PURPOSE = "primeview-phase1-handoff-v1";
export const PRODUCTION_WOO_WEBHOOK_URL =
  "https://hub.ccpatio.com/api/webhooks/woocommerce";

/** Deterministic fallback when PRIMEVIEW_HANDOFF_TOKEN is unset. */
export function derivePrimeviewHandoffTokenFromEmbedSecret(
  embedSecret: string = getGhlEmbedSecret(),
): string {
  if (!embedSecret) return "";
  return createHmac("sha256", embedSecret)
    .update(PRIMEVIEW_HANDOFF_TOKEN_PURPOSE)
    .digest("hex");
}

export function resolveExpectedPrimeviewHandoffToken(): string {
  const explicit = process.env.PRIMEVIEW_HANDOFF_TOKEN?.trim() ?? "";
  if (explicit) return explicit;
  return derivePrimeviewHandoffTokenFromEmbedSecret();
}

export type PrimeviewHandoffAuthResult =
  | { ok: true; token: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Timing-safe partner-token gate for `/partner/primeview-handoff` and download APIs.
 * Missing token → 401. Present but invalid → 403.
 */
export function authenticatePrimeviewHandoffToken(
  token: string | null | undefined,
): PrimeviewHandoffAuthResult {
  const provided = typeof token === "string" ? token.trim() : "";
  if (!provided) {
    return { ok: false, status: 401, reason: "Missing partner handoff token." };
  }
  const expected = resolveExpectedPrimeviewHandoffToken();
  if (!expected) {
    return {
      ok: false,
      status: 403,
      reason: "PrimeView handoff token is not configured on the Hub.",
    };
  }
  if (!timingSafeEqualString(provided, expected)) {
    return { ok: false, status: 403, reason: "Invalid partner handoff token." };
  }
  return { ok: true, token: provided };
}

export function buildPrimeviewHandoffPath(token?: string): string {
  const t = (token ?? resolveExpectedPrimeviewHandoffToken()).trim();
  if (!t) return "/partner/primeview-handoff";
  return `/partner/primeview-handoff?token=${encodeURIComponent(t)}`;
}

export function downloadUrlForArtifact(
  artifact: "csv" | "spec" | "swatches" | "finishes",
  token: string,
): string {
  return `/api/partner/primeview-handoff/download?artifact=${artifact}&token=${encodeURIComponent(token)}`;
}
