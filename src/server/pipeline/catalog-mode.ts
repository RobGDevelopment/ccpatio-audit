/**
 * Catalog publish mutation gate (Factory BOM + MDM master-data).
 *
 * Distinct from ORDER_PIPELINE_MODE which only gates sales-order / MTO POSTs.
 *
 * CATALOG_PUBLISH_MODE:
 *   log  — dry-run (default)
 *   live — allow Katana recipe / product_operation_rows / catalog mutations
 *
 * Backward compat: if CATALOG_PUBLISH_MODE is unset, ORDER_PIPELINE_MODE=live
 * still enables catalog mutations so existing deploys keep working.
 * KATANA_E2E_MIRROR=true always allows mutations (Playwright / qa mirror).
 */
import {
  getOrderPipelineMode,
  pipelineModeLabel,
  type OrderPipelineMode,
} from "@/server/pipeline/mode";

export type CatalogPublishMode = "log" | "live";

export function getCatalogPublishMode(): CatalogPublishMode {
  const raw = process.env.CATALOG_PUBLISH_MODE?.trim().toLowerCase();
  if (raw === "live" || raw === "log") return raw;

  // Legacy fallback — do not treat "approve" as live catalog.
  const orderMode = getOrderPipelineMode();
  return orderMode === "live" ? "live" : "log";
}

export function isKatanaE2eMirror(): boolean {
  return process.env.KATANA_E2E_MIRROR?.trim().toLowerCase() === "true";
}

/** True when Katana catalog recipe/ops/product POSTs are allowed. */
export function canMutateKatanaCatalog(
  mode: CatalogPublishMode = getCatalogPublishMode(),
): boolean {
  return mode === "live" || isKatanaE2eMirror();
}

export function catalogPublishModeLabel(
  mode: CatalogPublishMode = getCatalogPublishMode(),
): string {
  if (isKatanaE2eMirror() && mode !== "live") {
    return "e2e-mirror (catalog mutations allowed)";
  }
  return mode === "live"
    ? "live (catalog recipes + ops)"
    : "log (catalog dry-run)";
}

/** Order-pipeline label helper re-export for sync messages that mention both. */
export function orderModeNote(mode: OrderPipelineMode = getOrderPipelineMode()): string {
  return pipelineModeLabel(mode);
}
