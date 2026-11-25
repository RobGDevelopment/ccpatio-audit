/**
 * Sync storefront swatch JSON builders for handoff / CSV feeds.
 * Strictly the active e-commerce roster (32 + operator-added callers) —
 * never emits legacy showroom codes (FAB-ACT-ASH, etc.).
 */

import {
  ECOMMERCE_32_FINISHES,
  ecommerceFinishesByCategory,
  isLegacyShowroomFinishSku,
  type EcommerceFinishDefinition,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import { deriveFinishPhysicalScale } from "@/server/assets/finish-assets";
import { fabricSwatchPublicUrl } from "@/server/assets/finish-assets";

export type StorefrontSwatchManifestEntry = {
  label: string;
  color: string;
  image_url: string | null;
  texture_2k_url: string | null;
  sample_width_in: number | null;
  sample_height_in: number | null;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
  repeat_inches: number | null;
  repeat_w_in: number | null;
  repeat_h_in: number | null;
  texture_scale: number | null;
  quality_status: string;
  fabric_sku?: string;
  powder_sku?: string;
  dekton_sku?: string;
};

function entryFromDef(
  def: EcommerceFinishDefinition,
  key: "fabric_sku" | "powder_sku" | "dekton_sku",
): StorefrontSwatchManifestEntry {
  const pr = def.patternRepeatIn;
  const scale = deriveFinishPhysicalScale({
    croppedWidthIn: null,
    patternRepeatIn: pr,
    stripePeriodIn: pr?.h ?? null,
    sku: def.sku,
  });
  let image_url: string | null = null;
  if (def.category === "fabric") {
    try {
      image_url = fabricSwatchPublicUrl(def.sku);
    } catch {
      image_url = null;
    }
  }
  return {
    label: def.displayName,
    color: def.hex,
    image_url,
    texture_2k_url: image_url,
    sample_width_in: scale.sample_width_in,
    sample_height_in: scale.sample_height_in,
    pattern_repeat_w_in: pr?.w ?? null,
    pattern_repeat_h_in: pr?.h ?? null,
    repeat_inches: scale.repeat_inches,
    repeat_w_in: pr?.w ?? null,
    repeat_h_in: pr?.h ?? null,
    texture_scale: scale.texture_scale,
    quality_status: "placeholder_lowres",
    [key]: def.sku,
  };
}

/** Active fabric swatches JSON for Meta: acf_fabric_swatches_json. */
export function buildActiveFabricSwatchesJson(
  extraActive: ReadonlyArray<{ sku: string; name: string; hex?: string }> = [],
): string {
  const fabrics = ecommerceFinishesByCategory("fabric");
  const seen = new Set(fabrics.map((f) => f.sku));
  const arr: StorefrontSwatchManifestEntry[] = fabrics.map((f) =>
    entryFromDef(f, "fabric_sku"),
  );
  for (const extra of extraActive) {
    const sku = extra.sku.trim().toUpperCase();
    if (!sku || seen.has(sku) || isLegacyShowroomFinishSku(sku)) continue;
    seen.add(sku);
    const scale = deriveFinishPhysicalScale({ croppedWidthIn: null, sku });
    let image_url: string | null = null;
    try {
      image_url = fabricSwatchPublicUrl(sku);
    } catch {
      image_url = null;
    }
    arr.push({
      label: extra.name,
      color: extra.hex ?? "#CCCCCC",
      image_url,
      texture_2k_url: image_url,
      sample_width_in: scale.sample_width_in,
      sample_height_in: scale.sample_height_in,
      pattern_repeat_w_in: null,
      pattern_repeat_h_in: null,
      repeat_inches: scale.repeat_inches,
      repeat_w_in: null,
      repeat_h_in: null,
      texture_scale: scale.texture_scale,
      quality_status: "placeholder_lowres",
      fabric_sku: sku,
    });
  }
  return JSON.stringify(arr);
}

/** Active powder swatches JSON for Meta: acf_powder_swatches_json. */
export function buildActivePowderSwatchesJson(): string {
  return JSON.stringify(
    ecommerceFinishesByCategory("powder").map((f) => entryFromDef(f, "powder_sku")),
  );
}

/** Active Dekton swatches JSON for Meta: acf_dekton_swatches_json. */
export function buildActiveDektonSwatchesJson(): string {
  return JSON.stringify(
    ecommerceFinishesByCategory("dekton").map((f) => entryFromDef(f, "dekton_sku")),
  );
}

/** Assert roster fabric JSON never contains legacy showroom SKUs. */
export function assertNoLegacyShowroomInFabricJson(json: string): void {
  const parsed = JSON.parse(json) as Array<{ fabric_sku?: string }>;
  for (const row of parsed) {
    const sku = (row.fabric_sku ?? "").toUpperCase();
    if (isLegacyShowroomFinishSku(sku)) {
      throw new Error(`Legacy showroom finish leaked into fabric swatches: ${sku}`);
    }
  }
  const hasCabana = parsed.some((r) => (r.fabric_sku ?? "").toUpperCase() === "FAB-CAB-CLA");
  if (!hasCabana) {
    throw new Error("FAB-CAB-CLA (Cabana Classic) missing from fabric swatches JSON");
  }
}

export function activeEcommerceFinishCount(): number {
  return ECOMMERCE_32_FINISHES.length;
}
