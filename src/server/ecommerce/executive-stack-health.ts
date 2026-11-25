/**
 * Full-stack Executive Control Center health strip — 7 clickable layers.
 * Pure status derivation helpers + probe result shapes (no env flag flips).
 */

export type StackLampStatus = "Healthy" | "Degraded" | "Action Required";

export type StackLayerId =
  | "supabase"
  | "katana"
  | "qbo"
  | "woocommerce"
  | "ghl"
  | "fedex"
  | "inngest_dlq";

export type StackLayerPill = {
  id: StackLayerId;
  label: string;
  status: StackLampStatus;
  detail: string;
  /** Optional stripped diagnostic (e.g. WP critical error snippet). */
  errorSnippet?: string | null;
  /** Operator CTA labels rendered inline on the pill strip. */
  actions?: Array<{ id: string; label: string }>;
};

export type ExecutiveStackHealth = {
  checkedAt: string;
  layers: StackLayerPill[];
  heldOrderCount: number;
  missingDimsSkuCount: number;
  openDlqCount: number;
  qboLedgerMode: string;
};

export const STACK_LAYER_LABELS: Record<StackLayerId, string> = {
  supabase: "Supabase",
  katana: "Katana MRP",
  qbo: "QuickBooks",
  woocommerce: "WooCommerce",
  ghl: "GHL CRM",
  fedex: "FedEx LTL",
  inngest_dlq: "Inngest",
};

const PROBE_FAILED_DETAIL = "Probe Failed — Click to Diagnose & Retry";

/**
 * Always-mounted 7-pill skeleton used for SSR hydration and probe/401 failures.
 * Never return an empty strip — pills stay in the DOM Amber/Red with CTAs.
 */
export function probeFailedStackLayers(
  detail = PROBE_FAILED_DETAIL,
): StackLayerPill[] {
  return (Object.keys(STACK_LAYER_LABELS) as StackLayerId[]).map((id) => {
    const base: StackLayerPill = {
      id,
      label: STACK_LAYER_LABELS[id],
      status: "Action Required",
      detail,
    };
    if (id === "katana") {
      base.actions = [
        { id: "katana_sync_now", label: "Run Katana Sync Now" },
        { id: "katana_reset_bucket_sync", label: "Reset Bucket & Sync Katana Now" },
      ];
    } else if (id === "qbo") {
      base.actions = [
        { id: "qbo_reconnect", label: "Reconnect QuickBooks" },
        { id: "qbo_verify_token", label: "Verify Live QBO Token" },
      ];
    } else if (id === "woocommerce") {
      base.actions = [
        { id: "woo_retest", label: "Re-Test Connection" },
        { id: "woo_copy_diagnostic", label: "Copy Diagnostic Report for PrimeView" },
        { id: "woo_held_orders", label: "Held Orders" },
      ];
    } else if (id === "fedex") {
      base.actions = [{ id: "fedex_view_missing_dims", label: "View SKUs Missing Dims →" }];
    } else if (id === "inngest_dlq") {
      base.actions = [
        { id: "dlq_archive_stale", label: "Resolve / Archive Stale Test Failures" },
      ];
    } else if (id === "supabase" || id === "ghl") {
      base.actions = [{ id: "layer_reprobe", label: "Re-Probe" }];
    }
    return base;
  });
}

export function lampFromState(
  state: "healthy" | "degraded" | "critical" | "green" | "amber" | "red",
): StackLampStatus {
  if (state === "healthy" || state === "green") return "Healthy";
  if (state === "degraded" || state === "amber") return "Degraded";
  return "Action Required";
}

const WP_CRITICAL_RE = /there has been a critical error on this website/i;
const HTML_DOC_RE = /<!doctype\s+html|<html[\s>]/i;

/**
 * Detect WordPress HTML / critical PHP error responses that previously
 * presented as a fake-green Woo connection.
 */
export function classifyWooProbeBody(input: {
  httpStatus: number;
  contentType?: string | null;
  bodyText: string;
}): {
  ok: boolean;
  status: StackLampStatus;
  label: string;
  snippet: string | null;
} {
  const raw = input.bodyText ?? "";
  const ct = (input.contentType ?? "").toLowerCase();
  const looksHtml = ct.includes("text/html") || HTML_DOC_RE.test(raw.slice(0, 500));
  const critical = WP_CRITICAL_RE.test(raw);
  const snippet = stripHtmlSnippet(raw);

  if (input.httpStatus >= 500 || critical) {
    return {
      ok: false,
      status: "Action Required",
      label: "WP Critical Error",
      snippet,
    };
  }
  if (looksHtml && !ct.includes("application/json")) {
    return {
      ok: false,
      status: "Action Required",
      label: "WP Critical Error",
      snippet: snippet || "WordPress returned HTML instead of JSON.",
    };
  }
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return {
      ok: false,
      status: "Action Required",
      label: `Woo HTTP ${input.httpStatus}`,
      snippet,
    };
  }
  try {
    JSON.parse(raw);
  } catch {
    if (raw.trim()) {
      return {
        ok: false,
        status: "Action Required",
        label: "WP Critical Error",
        snippet: snippet || "Non-JSON WooCommerce response.",
      };
    }
  }
  return { ok: true, status: "Healthy", label: "Connected", snippet: null };
}

/** Strip tags / collapse whitespace for operator-facing diagnostic copy. */
export function stripHtmlSnippet(html: string, maxLen = 240): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen)}…` : stripped;
}

export function buildWooDiagnosticReport(input: {
  host: string;
  httpStatus: number;
  label: string;
  snippet: string | null;
  checkedAt?: string;
}): string {
  return [
    "CC Patio · WooCommerce Diagnostic Report for PrimeView",
    `Checked: ${input.checkedAt ?? new Date().toISOString()}`,
    `Host: ${input.host}`,
    `HTTP: ${input.httpStatus}`,
    `Status: ${input.label}`,
    `Snippet: ${input.snippet ?? "(none)"}`,
  ].join("\n");
}

/** Title Case that preserves outdoor-furniture acronyms (BH, SH, AH, OD, LED…). */
const PRESERVE_ACRONYMS = new Set([
  "BH",
  "SH",
  "AH",
  "OD",
  "ID",
  "LED",
  "UV",
  "LP",
  "NG",
  "BBQ",
  "3D",
  "II",
  "III",
  "LS",
  "RS",
  "L",
  "W",
  "H",
  "USD",
  "WP",
  "GLB",
  "USDZ",
]);

export function storefrontTitlePreserveAcronyms(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, "");
      if (PRESERVE_ACRONYMS.has(bare.toUpperCase())) {
        return w.replace(bare, bare.toUpperCase());
      }
      if (/^\d/.test(w)) return w;
      return w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(" ");
}
