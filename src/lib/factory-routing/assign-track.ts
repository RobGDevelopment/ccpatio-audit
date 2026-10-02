/**
 * SKU → Standard Track family resolver.
 *
 * Binding: docs/FACTORY_FLOOR_TOPOLOGY.md
 * Tracks: src/lib/factory-routing/resources.ts
 *
 * Rules (first match wins):
 *   CUT-* / raw materials / colorways     → null
 *   FIN-*                                 → final_assembly
 *   *-CUSH / *-CUSHION                    → cushion
 *   *-FRAME                               → aluminum_frame
 *   Producible with DKT / Dekton / stone  → dekton_top
 *   else                                  → null
 *
 * STN-* / DKT-* material slabs stay null (isHubRawMaterialSku).
 * Dekton track is for producible stone parents (ASM/SA with DKT token, etc.).
 */

import { isHubRawMaterialSku } from "@/lib/raw-material-sku";
import type { StandardTrackId } from "./resources";

export type AssignTrackInput = {
  sku: string;
  /** Optional display name — used only for Dekton / stone hints. */
  name?: string | null;
  /**
   * Optional Hub item_type. When `raw_material` / `service`, always null
   * even if the SKU string looks like a frame.
   */
  itemType?: string | null;
};

export type AssignTrackResult = {
  sku: string;
  trackId: StandardTrackId | null;
  reason: string;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function isCutIdentitySku(sku: string): boolean {
  return sku.startsWith("CUT-");
}

function isCushionSku(sku: string): boolean {
  return /(?:^|-)CUSH(?:ION)?(?:-|$)/.test(sku);
}

function isFrameSku(sku: string): boolean {
  return /(?:^|-)FRAME(?:-|$)/.test(sku);
}

/**
 * Stone specialty on producible parents — not STN-/DKT- material prefixes
 * (those are screened out earlier via isHubRawMaterialSku).
 */
function looksLikeDektonParent(sku: string, name: string): boolean {
  if (/(?:^|-)DKT(?:-|$)/.test(sku)) return true;
  if (sku.includes("DEKTON")) return true;
  if (/(?:^|-)STONE(?:-|$)/.test(sku)) return true;
  // Producible SA/ASM with an embedded STN token (e.g. ASM-…-STN-TOP)
  if (
    (sku.startsWith("ASM-") || sku.startsWith("SA-") || sku.startsWith("FIN-")) &&
    /(?:^|-)STN(?:-|$)/.test(sku)
  ) {
    return true;
  }
  if (/\bdekton\b/i.test(name) || /\bsintered\b/i.test(name)) return true;
  return false;
}

/**
 * Resolve which Standard Track (if any) a Hub SKU should receive.
 */
export function assignStandardTrack(
  input: AssignTrackInput | string,
): AssignTrackResult {
  const raw = typeof input === "string" ? input : input.sku;
  const name =
    typeof input === "string" ? "" : String(input.name ?? "").trim();
  const itemType =
    typeof input === "string"
      ? null
      : String(input.itemType ?? "")
          .trim()
          .toLowerCase() || null;

  const sku = normalizeSku(raw);
  if (!sku) {
    return { sku: "", trackId: null, reason: "empty_sku" };
  }

  if (isCutIdentitySku(sku)) {
    return { sku, trackId: null, reason: "cut_identity" };
  }

  if (itemType === "raw_material" || itemType === "service") {
    return { sku, trackId: null, reason: `item_type_${itemType}` };
  }

  if (isHubRawMaterialSku(sku)) {
    return { sku, trackId: null, reason: "raw_material_prefix" };
  }

  // FIN-* always converges at Final Assembly (even stone FGs pack here).
  if (sku.startsWith("FIN-")) {
    return { sku, trackId: "final_assembly", reason: "fin_prefix" };
  }

  if (isCushionSku(sku)) {
    return { sku, trackId: "cushion", reason: "cush_suffix" };
  }

  if (isFrameSku(sku)) {
    return { sku, trackId: "aluminum_frame", reason: "frame_suffix" };
  }

  if (looksLikeDektonParent(sku, name)) {
    return { sku, trackId: "dekton_top", reason: "dekton_or_stone" };
  }

  return { sku, trackId: null, reason: "unmatched_family" };
}

/** Convenience: track id only. */
export function resolveTrackId(
  input: AssignTrackInput | string,
): StandardTrackId | null {
  return assignStandardTrack(input).trackId;
}
