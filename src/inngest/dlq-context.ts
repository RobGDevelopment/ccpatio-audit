/**
 * Phase 10 Task 3 (D4) — alert context for the global DLQ.
 *
 * The DLQ handler is the SINGLE alert authority: an Inngest function with an `onFailure` hook
 * that also calls `sendOhCrapAlert` would alert twice for one exhausted run (the `-failure`
 * function and `globalDlqHandler` both fire from `inngest/function.failed`). So the per-function
 * knowledge the old hooks carried (which id to show, which admin page resolves it) lives HERE,
 * as a pure resolver, and `handleFunctionFailed` uses it to build the one alert.
 *
 * Pure: no I/O. NEVER throws: a garbage payload yields `{}` (the generic alert).
 */
import type { OhCrapAlertInput } from "@/server/alerts/oh-crap";

export type DlqAlertContext = {
  /** Replaces the run id as the alert's external id when the original event carries one. */
  externalId?: string;
  sku?: string;
  /** Path-only admin URL. Omitted => the alert builder's generic quarantine link. */
  resolutionPath?: string;
  source?: OhCrapAlertInput["source"];
};

/** Inngest reports `function_id` with the app prefix (`ccpatio-middleware-<id>`): match both. */
export function matchesFunctionId(functionId: string | null | undefined, bareId: string): boolean {
  if (!functionId) return false;
  return functionId === bareId || functionId.endsWith(`-${bareId}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `String(x ?? "")` exactly as the old onFailure hooks did. */
function textOf(value: unknown): string {
  return String(value ?? "");
}

function firstWooSku(order: Record<string, unknown> | null): string | undefined {
  const lineItems = order?.line_items;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return undefined;
  const sku = asRecord(lineItems[0])?.sku;
  return typeof sku === "string" && sku.trim() ? sku.trim() : undefined;
}

type Resolver = (data: Record<string, unknown> | null) => DlqAlertContext;

const RESOLVERS: ReadonlyArray<{ functionId: string; resolve: Resolver }> = [
  {
    // Was the onFailure hook of publishApprovedProduct.
    functionId: "publish-approved-product",
    resolve: (data) => {
      const globalSku = textOf(data?.globalSku);
      const exportId = textOf(data?.exportId);
      return {
        externalId: exportId || globalSku || undefined,
        sku: globalSku || undefined,
        resolutionPath: globalSku
          ? `/admin/quarantine?sku=${encodeURIComponent(globalSku)}`
          : "/admin/quarantine",
        source: "system",
      };
    },
  },
  {
    // Was the onFailure hook of processCadUpload (its cad_uploads=failed update stays there).
    functionId: "process-cad-upload",
    resolve: (data) => {
      const globalSku = textOf(data?.globalSku);
      const uploadId = textOf(data?.uploadId);
      return {
        externalId: uploadId || globalSku || undefined,
        sku: globalSku || undefined,
        resolutionPath: globalSku
          ? `/admin/factory-bom?sku=${encodeURIComponent(globalSku)}`
          : "/admin/factory-bom",
        source: "system",
      };
    },
  },
  {
    // Was the onFailure hook (via alertPipelineFailure) of the old processWooCommerceOrder.
    functionId: "process-woocommerce-order",
    resolve: (data) => {
      const externalId = textOf(data?.id) || "unknown";
      const sku = firstWooSku(data);
      return {
        externalId,
        sku,
        resolutionPath: sku
          ? `/admin/dictionary?sku=${encodeURIComponent(sku)}`
          : `/admin/dictionary?source=woocommerce&externalId=${encodeURIComponent(externalId)}`,
        source: "woocommerce",
      };
    },
  },
];

/**
 * @param functionId `function_id` of the failed run (bare or app-prefixed)
 * @param originalEvent the ORIGINAL trigger event (`inngest/function.failed`'s `data.event`)
 */
export function resolveDlqContext(
  functionId: string | null | undefined,
  originalEvent: unknown,
): DlqAlertContext {
  try {
    const rule = RESOLVERS.find((candidate) => matchesFunctionId(functionId, candidate.functionId));
    if (!rule) return {};
    return rule.resolve(asRecord(asRecord(originalEvent)?.data));
  } catch {
    // Contract: never throw. A broken payload degrades to the generic alert, not to no alert.
    return {};
  }
}
