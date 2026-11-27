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
        { id: "qbo_verify_credentials_pair", label: "Verify QBO Credentials Pair" },
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
 * presented as a fake-green Woo connection. Prefer plain-English summaries;
 * keep raw JSON/HTML in `rawBody` for a collapsed `<details>` dump.
 */
export function classifyWooProbeBody(input: {
  httpStatus: number;
  contentType?: string | null;
  bodyText: string;
  host?: string | null;
}): {
  ok: boolean;
  status: StackLampStatus;
  label: string;
  snippet: string | null;
  rawBody: string | null;
} {
  const raw = input.bodyText ?? "";
  const ct = (input.contentType ?? "").toLowerCase();
  const host = (input.host ?? "").trim() || "WooCommerce host";
  const looksHtml = ct.includes("text/html") || HTML_DOC_RE.test(raw.slice(0, 500));
  const parsedJsonMessage = extractWooJsonMessage(raw);
  const critical =
    WP_CRITICAL_RE.test(raw) || WP_CRITICAL_RE.test(parsedJsonMessage ?? "");
  const snippet = stripHtmlSnippet(parsedJsonMessage || raw);
  const rawBody = raw.trim() ? raw.slice(0, 4000) : null;

  if (input.httpStatus >= 500 || critical) {
    return {
      ok: false,
      status: "Action Required",
      label: `WordPress PHP Critical Error (HTTP ${input.httpStatus || 500}) on ${host} — PrimeView plugin/theme fatal error`,
      snippet,
      rawBody,
    };
  }
  if (looksHtml && !ct.includes("application/json")) {
    return {
      ok: false,
      status: "Action Required",
      label: `WordPress PHP Critical Error (HTTP ${input.httpStatus || 500}) on ${host} — PrimeView plugin/theme fatal error`,
      snippet: snippet || "WordPress returned HTML instead of JSON.",
      rawBody,
    };
  }
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return {
      ok: false,
      status: "Action Required",
      label: `WooCommerce HTTP ${input.httpStatus} on ${host}`,
      snippet,
      rawBody,
    };
  }
  try {
    JSON.parse(raw);
  } catch {
    if (raw.trim()) {
      return {
        ok: false,
        status: "Action Required",
        label: `WordPress PHP Critical Error (HTTP ${input.httpStatus || 500}) on ${host} — PrimeView plugin/theme fatal error`,
        snippet: snippet || "Non-JSON WooCommerce response.",
        rawBody,
      };
    }
  }
  return { ok: true, status: "Healthy", label: "Connected", snippet: null, rawBody: null };
}

/** Pull `message` from Woo/WP JSON error envelopes when present. */
export function extractWooJsonMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; code?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    return null;
  }
  return null;
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
  sourceHost?: string;
  endpointProbed?: string;
  wpErrorCode?: string | null;
  finishesStaged?: number;
  aluminumSkusStaged?: number;
}): string {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const ymd = checkedAt.slice(0, 10).replace(/-/g, "");
  const documentId = `CCP-DIAG-WOO-${ymd}`;
  const sourceHost = input.sourceHost ?? "https://hub.ccpatio.com";
  const endpoint =
    input.endpointProbed ?? `https://${input.host.replace(/^https?:\/\//, "")}/wp-json/wc/v3`;
  const finishes = input.finishesStaged ?? 32;
  const aluminum = input.aluminumSkusStaged ?? 107;
  const downstream = process.env.DOWNSTREAM_MUTATIONS ?? "false";
  const wooLedger = process.env.WOO_LEDGER_MODE ?? "log";

  return [
    "═══════════════════════════════════════════════════════════════════",
    "CC Patio · Enterprise Integration Diagnostic Report for PrimeView",
    "═══════════════════════════════════════════════════════════════════",
    `Document ID: ${documentId}`,
    `Generated UTC: ${checkedAt}`,
    `Source Host: ${sourceHost}`,
    `Target Host: ${input.host}`,
    `Severity: P1 BLOCKER`,
    "",
    "── 1. Executive Summary ──",
    input.label,
    `WooCommerce staging at ${input.host} returned HTTP ${input.httpStatus}.`,
    "Storefront certification and Hub staging are blocked until PrimeView clears the WordPress fatal.",
    "",
    "── 2. Live Telemetry & Probe Evidence ──",
    `HTTP Status: ${input.httpStatus}`,
    `Endpoint Probed: ${endpoint}`,
    `WP Error Code: ${input.wpErrorCode ?? "(none / HTML critical)"}`,
    `Stripped Response: ${input.snippet ?? "(none)"}`,
    "",
    "── 3. Isolation & Change-Control Attestation ──",
    `DOWNSTREAM_MUTATIONS=${downstream}`,
    `WOO_LEDGER_MODE=${wooLedger}`,
    "Attestation: Zero outbound WooCommerce POST/PUT/PATCH/DELETE writes were sent from Hub during this probe.",
    "Inbound GET / health probes only. Ledger remains log-mode.",
    "",
    "── 4. Required PrimeView Engineering Actions ──",
    "1. Inspect wp-content/debug.log for the PHP fatal / plugin conflict at the time of this Document ID.",
    "2. Disable recently activated plugins/themes that hook /wp-json/wc/v3 and re-test.",
    "3. Verify /wp-json/wc/v3 returns application/json 200 (not HTML critical error).",
    "4. Confirm REST auth + permalinks; notify CC Patio Hub once green so staging push can resume.",
    "",
    "── 5. Staged Payload Summary ──",
    `Finishes staged (certified roster): ${finishes}`,
    `Aluminum SKUs staged (purchasable): ${aluminum}`,
    "No live mutations applied while WOO_LEDGER_MODE=log.",
    "═══════════════════════════════════════════════════════════════════",
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
      // Preserve dimension tokens like d15cm / (d15cm)
      if (/^d\d/i.test(bare) || /^\d/.test(w)) return w;
      return w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(" ");
}
