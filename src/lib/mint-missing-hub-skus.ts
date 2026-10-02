/**
 * Classify live Katana SKUs that are missing from Hub sku_mappings.
 *
 * Mint order (FK-safe):
 *   1. sku_mappings (canonical PK — there is no parent items table)
 *   2. finished_goods_catalog when item_type = finished_good
 *   3. raw_materials_catalog when item_type = raw_material
 *
 * CUT-* is drawing identity but still needs a Hub shell if Katana has it
 * as a product (sub_assembly, never a recipe child by itself).
 */

import {
  isHubRawMaterialSku,
  isHubSubAssemblySku,
} from "@/lib/raw-material-sku";
import type { LiveKatanaSku } from "@/lib/hub-katana-sync";
import { normalizeHubSku } from "@/lib/hub-katana-sync";
import type { ItemType } from "@/server/db/schema";

export type MintKind = "product" | "material";

export type MintPlanRow = {
  action: "mint" | "skip_empty";
  sku: string;
  name: string;
  itemType: ItemType;
  category: string;
  uom: string;
  kind: MintKind;
  needsFinishedGoodsCatalog: boolean;
  needsRawMaterialsCatalog: boolean;
  katanaVariantId: number;
  katanaMaterialId: number | null;
  reason: string;
};

export function classifyMintKind(live: LiveKatanaSku): MintKind {
  return live.productId != null ? "product" : "material";
}

/**
 * Prefix-first, then Katana product-vs-material fallback.
 * Coerces RM-* / FAB-* etc. to raw_material even if parked as a product.
 */
export function classifyMintItemType(
  sku: string,
  kind: MintKind,
): ItemType {
  const s = normalizeHubSku(sku);
  if (isHubRawMaterialSku(s)) return "raw_material";
  if (isHubSubAssemblySku(s)) return "sub_assembly";
  if (s.startsWith("FIN-")) return "finished_good";
  if (s.startsWith("CUT-")) return "sub_assembly";
  if (s.startsWith("SVC-")) return "service";
  if (kind === "material") return "raw_material";
  return "finished_good";
}

/** Dictionary category labels (CreateSkuModal). */
export function classifyMintCategory(sku: string, itemType: ItemType): string {
  const s = normalizeHubSku(sku);
  if (itemType === "sub_assembly") return "Sub-Assembly";
  if (itemType === "finished_good") return "Finished Good";
  if (itemType === "service") return "Other";
  if (s.startsWith("FAB-") || s.startsWith("RM-FAB-")) return "Fabric";
  if (s.startsWith("PWD-") || s.startsWith("RM-PWD-") || s.startsWith("PWR-")) {
    return "Powder Coat";
  }
  if (s.startsWith("MET-") || s.startsWith("RM-MET-") || s.startsWith("ALU-")) {
    return "Metal";
  }
  if (
    s.startsWith("STN-") ||
    s.startsWith("DKT-") ||
    s.startsWith("RM-DKT-")
  ) {
    return "Dekton";
  }
  if (s.startsWith("HRD-") || s.startsWith("RM-HRD-")) return "Hardware";
  if (s.startsWith("SHD-")) return "Shade";
  if (s.startsWith("FRP-")) return "Firepit";
  return "Other";
}

export function classifyMintUom(sku: string, itemType: ItemType): string {
  const s = normalizeHubSku(sku);
  if (s.startsWith("FAB-") || s.startsWith("RM-FAB-")) return "yd";
  if (s.startsWith("MET-") || s.startsWith("RM-MET-") || s.startsWith("ALU-")) {
    return "ft";
  }
  if (itemType === "raw_material") return "ea";
  return "ea";
}

export function planMintRow(live: LiveKatanaSku): MintPlanRow {
  const sku = normalizeHubSku(live.sku);
  if (!sku) {
    return {
      action: "skip_empty",
      sku: "",
      name: live.name,
      itemType: "raw_material",
      category: "Other",
      uom: "ea",
      kind: classifyMintKind(live),
      needsFinishedGoodsCatalog: false,
      needsRawMaterialsCatalog: false,
      katanaVariantId: live.variantId,
      katanaMaterialId: live.materialId,
      reason: "empty_sku",
    };
  }

  const kind = classifyMintKind(live);
  const itemType = classifyMintItemType(sku, kind);
  const category = classifyMintCategory(sku, itemType);
  const uom = classifyMintUom(sku, itemType);

  return {
    action: "mint",
    sku,
    name: live.name.trim() || sku,
    itemType,
    category,
    uom,
    kind,
    needsFinishedGoodsCatalog: itemType === "finished_good",
    needsRawMaterialsCatalog: itemType === "raw_material",
    katanaVariantId: live.variantId,
    katanaMaterialId: live.materialId,
    reason: `${kind}_${itemType}`,
  };
}

/**
 * Katana live SKUs minus Hub sku_mappings. First live occurrence wins.
 */
export function planMintMissingHubSkus(
  liveSkus: readonly LiveKatanaSku[],
  hubSkus: ReadonlySet<string>,
): MintPlanRow[] {
  const hub = new Set([...hubSkus].map((s) => normalizeHubSku(s)).filter(Boolean));
  const seen = new Set<string>();
  const plan: MintPlanRow[] = [];

  for (const live of liveSkus) {
    const sku = normalizeHubSku(live.sku);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    if (hub.has(sku)) continue;
    plan.push(planMintRow(live));
  }

  return plan.sort((a, b) => a.sku.localeCompare(b.sku));
}

export function summarizeMintPlan(plan: readonly MintPlanRow[]): {
  mint: number;
  finishedGood: number;
  subAssembly: number;
  rawMaterial: number;
  service: number;
  fgCatalog: number;
  rmCatalog: number;
} {
  const mintRows = plan.filter((r) => r.action === "mint");
  return {
    mint: mintRows.length,
    finishedGood: mintRows.filter((r) => r.itemType === "finished_good").length,
    subAssembly: mintRows.filter((r) => r.itemType === "sub_assembly").length,
    rawMaterial: mintRows.filter((r) => r.itemType === "raw_material").length,
    service: mintRows.filter((r) => r.itemType === "service").length,
    fgCatalog: mintRows.filter((r) => r.needsFinishedGoodsCatalog).length,
    rmCatalog: mintRows.filter((r) => r.needsRawMaterialsCatalog).length,
  };
}
