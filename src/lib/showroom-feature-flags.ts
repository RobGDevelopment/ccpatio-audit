/**
 * Central Showroom sales-embed feature flags.
 * MTO Catalog + Order Desk CTAs stay in the codebase but default OFF so Phase 1
 * Option A polish can ship without deleting dormant paid-engagement surfaces.
 */

export type ShowroomFeatureFlags = {
  enableMtoCatalog: boolean;
  enableOrderDeskCta: boolean;
};

export type ShowroomFeatureFlagOverrides = Partial<ShowroomFeatureFlags>;

function envEnabled(name: string): boolean {
  return process.env[name] === "true";
}

/** Read env flags with optional test/runtime overrides. Defaults are both false. */
export function getShowroomFeatureFlags(
  overrides?: ShowroomFeatureFlagOverrides,
): ShowroomFeatureFlags {
  return {
    enableMtoCatalog:
      overrides?.enableMtoCatalog ?? envEnabled("NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED"),
    enableOrderDeskCta:
      overrides?.enableOrderDeskCta ?? envEnabled("NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED"),
  };
}
