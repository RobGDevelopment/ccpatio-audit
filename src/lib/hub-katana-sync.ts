/**
 * Reverse-sync planner: live Katana variants → Hub sku_mappings + item_operations.
 *
 * Katana is SSOT for which SKUs still exist. Hub Postgres must archive ghosts
 * and replace item_operations with Standard Track / SMV rows for live products.
 *
 * Pure functions only — the ops script owns API + DB I/O.
 */

import { assignStandardTrack } from "@/lib/factory-routing/assign-track";
import {
  getStandardTrack,
  type StandardTrackId,
  type TrackStep,
} from "@/lib/factory-routing/resources";

export type KatanaVariantRow = {
  id?: number | null;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
};

export type LiveKatanaSku = {
  sku: string;
  name: string;
  variantId: number;
  productId: number | null;
  materialId: number | null;
};

export type HubSkuSnapshot = {
  sku: string;
  name: string;
  itemType: string;
  isActive: boolean;
};

export type GhostPlanAction = "archive" | "reactivate" | "keep_active" | "already_inactive";

export type GhostPlanRow = {
  action: GhostPlanAction;
  sku: string;
  name: string;
  itemType: string;
  reason: string;
};

export type OpsPlanAction = "upsert" | "skip_no_track" | "skip_missing_hub";

export type OpsPlanRow = {
  action: OpsPlanAction;
  sku: string;
  name: string;
  itemType: string;
  trackId: StandardTrackId | "";
  reason: string;
  steps: number;
};

export type HubOperationInsert = {
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins: string;
  runTimeMins: string;
};

export function normalizeHubSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function asFiniteId(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Index live (non-deleted) Katana variants by SKU. First occurrence wins.
 * Materials and products both count for ghost detection; ops use products only.
 */
export function indexLiveKatanaVariants(
  variants: readonly KatanaVariantRow[],
): {
  allSkus: Set<string>;
  bySku: Map<string, LiveKatanaSku>;
  products: LiveKatanaSku[];
} {
  const bySku = new Map<string, LiveKatanaSku>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeHubSku(String(v.sku ?? ""));
    if (!sku) continue;
    const variantId = asFiniteId(v.id);
    if (variantId == null) continue;
    if (bySku.has(sku)) continue;
    bySku.set(sku, {
      sku,
      name: String(v.name ?? "").trim(),
      variantId,
      productId: asFiniteId(v.product_id),
      materialId: asFiniteId(v.material_id),
    });
  }
  const products = [...bySku.values()]
    .filter((row) => row.productId != null)
    .sort((a, b) => a.sku.localeCompare(b.sku));
  return { allSkus: new Set(bySku.keys()), bySku, products };
}

/**
 * Hub SKUs absent from live Katana → archive.
 * Hub SKUs present in Katana but inactive → reactivate (mirror, not mint).
 */
export function planGhostArchives(
  hubRows: readonly HubSkuSnapshot[],
  liveKatanaSkus: ReadonlySet<string>,
): GhostPlanRow[] {
  const plan: GhostPlanRow[] = [];
  for (const row of hubRows) {
    const sku = normalizeHubSku(row.sku);
    if (!sku) continue;
    const inKatana = liveKatanaSkus.has(sku);
    if (!inKatana) {
      plan.push({
        action: row.isActive ? "archive" : "already_inactive",
        sku,
        name: row.name,
        itemType: row.itemType,
        reason: row.isActive
          ? "hub_sku_missing_from_katana"
          : "already_inactive_and_missing_from_katana",
      });
      continue;
    }
    if (!row.isActive) {
      plan.push({
        action: "reactivate",
        sku,
        name: row.name,
        itemType: row.itemType,
        reason: "live_in_katana_hub_inactive",
      });
      continue;
    }
    plan.push({
      action: "keep_active",
      sku,
      name: row.name,
      itemType: row.itemType,
      reason: "live_in_both",
    });
  }
  return plan;
}

export function trackStepsToInserts(
  itemSku: string,
  steps: readonly TrackStep[],
): HubOperationInsert[] {
  const sku = normalizeHubSku(itemSku);
  return steps.map((step) => ({
    itemSku: sku,
    workCenter: step.resource,
    sequence: step.sequence,
    setupTimeMins:
      step.setupTimeMins > 0 ? step.setupTimeMins.toFixed(4) : "0.0000",
    runTimeMins: step.runTimeMins.toFixed(4),
  }));
}

/**
 * For every live Katana *product*, resolve SMV Standard Track and emit Hub ops.
 * SKUs not present on sku_mappings cannot be inserted (FK) — reported, not minted.
 */
export function planOperationSync(
  liveProducts: readonly LiveKatanaSku[],
  hubBySku: ReadonlyMap<string, HubSkuSnapshot>,
): { rows: OpsPlanRow[]; inserts: HubOperationInsert[] } {
  const rows: OpsPlanRow[] = [];
  const inserts: HubOperationInsert[] = [];

  for (const product of liveProducts) {
    const hub = hubBySku.get(product.sku);
    if (!hub) {
      rows.push({
        action: "skip_missing_hub",
        sku: product.sku,
        name: product.name,
        itemType: "",
        trackId: "",
        reason: "live_in_katana_not_in_sku_mappings",
        steps: 0,
      });
      continue;
    }

    const resolved = assignStandardTrack({
      sku: product.sku,
      name: product.name || hub.name,
      itemType: hub.itemType,
    });

    if (!resolved.trackId) {
      rows.push({
        action: "skip_no_track",
        sku: product.sku,
        name: product.name || hub.name,
        itemType: hub.itemType,
        trackId: "",
        reason: resolved.reason,
        steps: 0,
      });
      continue;
    }

    const track = getStandardTrack(resolved.trackId);
    inserts.push(...trackStepsToInserts(product.sku, track));
    rows.push({
      action: "upsert",
      sku: product.sku,
      name: product.name || hub.name,
      itemType: hub.itemType,
      trackId: resolved.trackId,
      reason: resolved.reason,
      steps: track.length,
    });
  }

  return { rows, inserts };
}

export function summarizeGhostPlan(plan: readonly GhostPlanRow[]): {
  archive: number;
  reactivate: number;
  keepActive: number;
  alreadyInactive: number;
} {
  return {
    archive: plan.filter((r) => r.action === "archive").length,
    reactivate: plan.filter((r) => r.action === "reactivate").length,
    keepActive: plan.filter((r) => r.action === "keep_active").length,
    alreadyInactive: plan.filter((r) => r.action === "already_inactive").length,
  };
}

export function summarizeOpsPlan(plan: readonly OpsPlanRow[]): {
  upsert: number;
  skipNoTrack: number;
  skipMissingHub: number;
  steps: number;
} {
  return {
    upsert: plan.filter((r) => r.action === "upsert").length,
    skipNoTrack: plan.filter((r) => r.action === "skip_no_track").length,
    skipMissingHub: plan.filter((r) => r.action === "skip_missing_hub").length,
    steps: plan
      .filter((r) => r.action === "upsert")
      .reduce((sum, r) => sum + r.steps, 0),
  };
}
