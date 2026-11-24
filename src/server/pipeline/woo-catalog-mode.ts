/**
 * WooCommerce catalog publish gate (MDM channel fan-out).
 *
 * WOO_CATALOG_PUBLISH_MODE:
 *   unset — preserve legacy behavior (REST writes allowed)
 *   log   — dry-run: block unintended Woo REST writes
 *   live  — allow REST writes
 *
 * Fail-open only when unset so existing deploys keep working; explicit `log` locks writes.
 */
export type WooCatalogPublishMode = "unset" | "log" | "live";

export function getWooCatalogPublishMode(
  env: Record<string, string | undefined> = process.env,
): WooCatalogPublishMode {
  const raw = env.WOO_CATALOG_PUBLISH_MODE?.trim().toLowerCase();
  if (raw === "log" || raw === "live") return raw;
  return "unset";
}

/** True when Woo REST product upserts are allowed. */
export function canMutateWooCommerceCatalog(
  mode: WooCatalogPublishMode = getWooCatalogPublishMode(),
): boolean {
  return mode !== "log";
}
