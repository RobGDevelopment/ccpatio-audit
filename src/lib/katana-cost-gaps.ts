/**
 * Live Katana cost-gap classifier + missing-ops export planner.
 *
 * Pure — no DB / no API. Callers supply live variant SKUs plus recipe/ops counts.
 *
 * Families in scope: FIN-* / SA-|ASM-*-FRAME / *-CUSH|CUSHION
 * Gap classes: ok_recipe | ops_only | empty | frame_rm_no_ops | cush_no_rm
 *
 * File 4 labor injection: emit Standard Tracks only for SKUs with zero
 * product_operation_rows. Existing ops (the ~$13.07 FIN class) are skipped so
 * the Katana "Add new product operations" importer cannot duplicate labor.
 */

import { assignStandardTrack } from "@/lib/factory-routing/assign-track";
import {
  getStandardTrack,
  type StandardTrackId,
} from "@/lib/factory-routing/resources";
import type { HubOperationForExport } from "@/lib/katana-operations-csv";
import { trackStepsToHubOperations } from "@/lib/katana-operations-csv";

export type CostGapFamily = "FIN" | "FRAME" | "CUSH" | "other";

export type CostGapClass =
  | "ok_recipe"
  | "ops_only"
  | "empty"
  | "frame_rm_no_ops"
  | "cush_no_rm"
  | "out_of_scope";

export type OpsPresence = "has_ops" | "missing_ops" | "out_of_scope";

export type CostGapClassification = {
  sku: string;
  family: CostGapFamily;
  gapClass: CostGapClass;
  opsPresence: OpsPresence;
  recipeRowCount: number;
  operationRowCount: number;
  trackId: StandardTrackId | null;
};

export type MissingOpsCandidate = {
  sku: string;
  name?: string;
  operationRowCount: number;
};

export type MissingOpsPlanRow = {
  sku: string;
  name: string;
  include: boolean;
  trackId: StandardTrackId | "";
  reason: string;
  steps: number;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function isCushionSku(sku: string): boolean {
  return /(?:^|-)CUSH(?:ION)?(?:-|$)/.test(sku);
}

function isSaOrAsmFrameSku(sku: string): boolean {
  if (!sku.startsWith("SA-") && !sku.startsWith("ASM-")) return false;
  return /(?:^|-)FRAME(?:-|$)/.test(sku);
}

/** FIN-* first, then CUSH, then SA/ASM FRAME. Everything else is out of scope. */
export function classifyCostGapFamily(skuRaw: string): CostGapFamily {
  const sku = normalizeSku(skuRaw);
  if (!sku) return "other";
  if (sku.startsWith("FIN-")) return "FIN";
  if (isCushionSku(sku)) return "CUSH";
  if (isSaOrAsmFrameSku(sku)) return "FRAME";
  return "other";
}

function toGapClass(input: {
  family: CostGapFamily;
  hasRecipe: boolean;
  hasOps: boolean;
}): CostGapClass {
  const { family, hasRecipe, hasOps } = input;
  if (family === "other") return "out_of_scope";

  if (family === "FRAME") {
    if (hasRecipe && !hasOps) return "frame_rm_no_ops";
    if (hasRecipe) return "ok_recipe";
    if (hasOps) return "ops_only";
    return "empty";
  }

  if (family === "CUSH") {
    if (!hasRecipe) return "cush_no_rm";
    if (!hasOps) return "ok_recipe";
    return "ok_recipe";
  }

  // FIN-*
  if (hasRecipe) return "ok_recipe";
  if (hasOps) return "ops_only";
  return "empty";
}

export function classifyKatanaCostGap(input: {
  sku: string;
  name?: string | null;
  recipeRowCount: number;
  operationRowCount: number;
}): CostGapClassification {
  const sku = normalizeSku(input.sku);
  const family = classifyCostGapFamily(sku);
  const recipeRowCount = Math.max(0, Math.floor(input.recipeRowCount) || 0);
  const operationRowCount =
    Math.max(0, Math.floor(input.operationRowCount) || 0);
  const hasRecipe = recipeRowCount > 0;
  const hasOps = operationRowCount > 0;

  const trackId =
    family === "other"
      ? null
      : assignStandardTrack({ sku, name: input.name ?? "" }).trackId;

  if (family === "other") {
    return {
      sku,
      family,
      gapClass: "out_of_scope",
      opsPresence: "out_of_scope",
      recipeRowCount,
      operationRowCount,
      trackId,
    };
  }

  return {
    sku,
    family,
    gapClass: toGapClass({ family, hasRecipe, hasOps }),
    opsPresence: hasOps ? "has_ops" : "missing_ops",
    recipeRowCount,
    operationRowCount,
    trackId,
  };
}

/**
 * File 4 gate: include only in-scope families with zero operation rows.
 * Existing ops must be skipped — Katana ops import adds, it does not replace.
 */
export function decideMissingOpsExport(
  input: MissingOpsCandidate,
): MissingOpsPlanRow {
  const sku = normalizeSku(input.sku);
  const name = String(input.name ?? "").trim();
  const family = classifyCostGapFamily(sku);
  const resolved = assignStandardTrack({ sku, name });
  const trackId = resolved.trackId ?? "";

  if (input.operationRowCount >= 1) {
    return {
      sku,
      name,
      include: false,
      trackId,
      reason: "skip_existing_ops",
      steps: 0,
    };
  }

  if (family === "other") {
    return {
      sku,
      name,
      include: false,
      trackId,
      reason: "skip_out_of_scope_family",
      steps: 0,
    };
  }

  if (!resolved.trackId) {
    return {
      sku,
      name,
      include: false,
      trackId: "",
      reason: resolved.reason,
      steps: 0,
    };
  }

  const steps = getStandardTrack(resolved.trackId).length;
  return {
    sku,
    name,
    include: true,
    trackId: resolved.trackId,
    reason: `missing_ops_${resolved.trackId}`,
    steps,
  };
}

export function planMissingOpsExport(
  candidates: readonly MissingOpsCandidate[],
): { plan: MissingOpsPlanRow[]; hubOps: HubOperationForExport[] } {
  const plan: MissingOpsPlanRow[] = [];
  const hubOps: HubOperationForExport[] = [];

  for (const candidate of candidates) {
    const row = decideMissingOpsExport(candidate);
    plan.push(row);
    if (!row.include || !row.trackId) continue;
    hubOps.push(
      ...trackStepsToHubOperations(
        row.sku,
        getStandardTrack(row.trackId),
        row.name,
      ),
    );
  }

  return { plan, hubOps };
}

export function summarizeCostGaps(rows: readonly CostGapClassification[]): {
  inScope: number;
  fin: number;
  frame: number;
  cush: number;
  finOkRecipe: number;
  finOpsOnly: number;
  finEmpty: number;
  frameOkRecipe: number;
  frameRmNoOps: number;
  frameOpsOnly: number;
  frameEmpty: number;
  frameMissingOps: number;
  cushOkRecipe: number;
  cushNoRm: number;
  cushMissingOps: number;
} {
  const inScope = rows.filter((r) => r.family !== "other");
  const of = (family: CostGapFamily, gap?: CostGapClass) =>
    inScope.filter(
      (r) => r.family === family && (gap == null || r.gapClass === gap),
    ).length;

  return {
    inScope: inScope.length,
    fin: of("FIN"),
    frame: of("FRAME"),
    cush: of("CUSH"),
    finOkRecipe: of("FIN", "ok_recipe"),
    finOpsOnly: of("FIN", "ops_only"),
    finEmpty: of("FIN", "empty"),
    frameOkRecipe: of("FRAME", "ok_recipe"),
    frameRmNoOps: of("FRAME", "frame_rm_no_ops"),
    frameOpsOnly: of("FRAME", "ops_only"),
    frameEmpty: of("FRAME", "empty"),
    frameMissingOps: inScope.filter(
      (r) => r.family === "FRAME" && r.opsPresence === "missing_ops",
    ).length,
    cushOkRecipe: of("CUSH", "ok_recipe"),
    cushNoRm: of("CUSH", "cush_no_rm"),
    cushMissingOps: inScope.filter(
      (r) => r.family === "CUSH" && r.opsPresence === "missing_ops",
    ).length,
  };
}

export function summarizeMissingOpsPlan(plan: readonly MissingOpsPlanRow[]): {
  include: number;
  skipExistingOps: number;
  skipOutOfScope: number;
  skipNoTrack: number;
  aluminumFrame: number;
  cushion: number;
  finalAssembly: number;
  dektonTop: number;
} {
  const included = plan.filter((r) => r.include);
  const skipReason = (reason: string) =>
    plan.filter((r) => !r.include && r.reason === reason).length;
  const track = (id: StandardTrackId) =>
    included.filter((r) => r.trackId === id).length;

  return {
    include: included.length,
    skipExistingOps: skipReason("skip_existing_ops"),
    skipOutOfScope: skipReason("skip_out_of_scope_family"),
    skipNoTrack: plan.filter(
      (r) => !r.include && r.reason !== "skip_existing_ops" && r.reason !== "skip_out_of_scope_family",
    ).length,
    aluminumFrame: track("aluminum_frame"),
    cushion: track("cushion"),
    finalAssembly: track("final_assembly"),
    dektonTop: track("dekton_top"),
  };
}
