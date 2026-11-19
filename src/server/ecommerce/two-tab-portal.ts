/**
 * Two-tab E-Commerce Command Center view helpers.
 * Tab 1 = Live storefront (sync_to_woo). Tab 2 = Phase 2 staging library.
 */

import { isFinishOrAddonSku, isPhase1StorefrontRow } from "./phase1-portal";
import {
  evaluateFieldBadges,
  isReadyToPromote,
  type BomReadiness,
  type FieldBadges,
} from "./phase2-hydration";
import { isProvisionalShell } from "./provisional-shell";

export type EcommerceCommandTab = "live" | "phase2";

export type Phase2SubFilter =
  | "phase2_sow"
  | "hub_library"
  | "ready_to_promote"
  | "needs_fields";

export type LiveSubView = "grouped_parents" | "sheet_grid";

export const LIVE_TAB_LABEL = "Live E-Commerce";
export const PHASE2_TAB_LABEL = "Phase 2 & New Products";

export const PHASE2_SUBFILTER_LABELS: Record<Phase2SubFilter, string> = {
  phase2_sow: "Phase 2 SOW Backlog (162)",
  hub_library: "Pre-Built Hub Library",
  ready_to_promote: "Ready to Promote",
  needs_fields: "Needs Fields",
};

export function isQboNoiseSku(input: {
  globalSku: string;
  productName?: string | null;
  msrpValue?: number | null;
}): boolean {
  const sku = input.globalSku.trim().toUpperCase();
  const name = (input.productName ?? "").toUpperCase();
  if (name.includes("ACCRUAL BASIS")) return true;
  if (sku.includes("ACCRUAL")) return true;
  if (input.msrpValue != null && input.msrpValue <= 0 && !sku.startsWith("FIN-") && !sku.startsWith("3P-")) {
    return true;
  }
  return false;
}

/** Tab 1: storefront-only rows. */
export function isLiveEcommerceRow(input: {
  globalSku: string;
  syncToWoo: boolean;
  productName?: string | null;
  msrpValue?: number | null;
}): boolean {
  if (!input.syncToWoo) return false;
  if (isQboNoiseSku(input)) return false;
  if (isFinishOrAddonSku(input.globalSku)) return false;
  return isPhase1StorefrontRow({
    globalSku: input.globalSku,
    msrpValue: input.msrpValue ?? null,
  }) || input.globalSku.startsWith("FIN-") || input.globalSku.startsWith("3P-");
}

export function readSowPhase(
  attributes: Record<string, unknown> | null | undefined,
): number | null {
  const raw = attributes?.sow_phase;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

export function readBomReadiness(
  attributes: Record<string, unknown> | null | undefined,
): BomReadiness {
  const raw = attributes?.bom_readiness;
  if (raw === "ready" || raw === "needs_variant_heal" || raw === "no_bom_yet") return raw;
  if (isProvisionalShell(attributes)) return "no_bom_yet";
  return "no_bom_yet";
}

export function readOptionCategories(
  attributes: Record<string, unknown> | null | undefined,
): string[] {
  const raw = attributes?.allowed_option_categories;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export type Phase2RowLike = {
  globalSku: string;
  productName: string;
  syncToWoo: boolean;
  msrpValue: number | null;
  hubLength: string | null;
  hubDepth: string | null;
  hubHeight: string | null;
  hubWeight: string | null;
  attributes?: Record<string, unknown> | null;
};

export function phase2BadgesForRow(row: Phase2RowLike): FieldBadges {
  return evaluateFieldBadges({
    msrp: row.msrpValue,
    length: row.hubLength,
    depth: row.hubDepth,
    height: row.hubHeight,
    weight: row.hubWeight,
    optionCategories: readOptionCategories(row.attributes),
    bomReadiness: readBomReadiness(row.attributes),
  });
}

export function matchesPhase2SubFilter(
  row: Phase2RowLike,
  filter: Phase2SubFilter,
): boolean {
  if (isQboNoiseSku(row) || isFinishOrAddonSku(row.globalSku)) return false;
  if (!(row.globalSku.startsWith("FIN-") || row.globalSku.startsWith("3P-"))) return false;
  if (row.syncToWoo) return false; // already live

  const sowPhase = readSowPhase(row.attributes);
  const badges = phase2BadgesForRow(row);
  const ready = isReadyToPromote(badges);

  switch (filter) {
    case "phase2_sow":
      return sowPhase === 2;
    case "hub_library":
      return sowPhase !== 2 && (row.msrpValue == null || row.msrpValue > 0);
    case "ready_to_promote":
      return ready;
    case "needs_fields":
      return !ready;
    default:
      return false;
  }
}
