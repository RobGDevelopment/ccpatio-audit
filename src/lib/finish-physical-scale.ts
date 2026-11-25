/**
 * Client-safe uniform UV / physical scale helpers (no DB / Node imports).
 */
import {
  ecommerceFinishBySku,
  type EcommerceFinishFamily,
} from "@/server/ecommerce/ecommerce-32-finish-roster";

export type FinishPhysicalScale = {
  repeat_inches: number;
  texture_scale: number;
  sample_width_in: number;
  sample_height_in: number;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
};

export const CANVAS_SOLID_SKUS = [
  "FAB-CAN-WHI",
  "FAB-CAN-BLA",
  "FAB-CAN-HEN",
  "FAB-CAN-NAV",
] as const;

export function uniformFinishPhysicalScale(sku: string): FinishPhysicalScale {
  const key = sku.trim().toUpperCase();
  const def = ecommerceFinishBySku(key);
  const family = def?.family;

  if (key === "FAB-CAB-CLA") {
    return {
      repeat_inches: 7,
      texture_scale: 7,
      sample_width_in: 7,
      sample_height_in: 7,
      pattern_repeat_w_in: 7,
      pattern_repeat_h_in: 7,
    };
  }
  if (family === "ultraleather") {
    return {
      repeat_inches: 6,
      texture_scale: 6,
      sample_width_in: 6,
      sample_height_in: 6,
      pattern_repeat_w_in: null,
      pattern_repeat_h_in: null,
    };
  }
  if (family === "dekton") {
    return {
      repeat_inches: 24,
      texture_scale: 24,
      sample_width_in: 24,
      sample_height_in: 24,
      pattern_repeat_w_in: null,
      pattern_repeat_h_in: null,
    };
  }
  if (family === "powder") {
    return {
      repeat_inches: 4,
      texture_scale: 4,
      sample_width_in: 4,
      sample_height_in: 4,
      pattern_repeat_w_in: null,
      pattern_repeat_h_in: null,
    };
  }
  return {
    repeat_inches: 8,
    texture_scale: 8,
    sample_width_in: 8,
    sample_height_in: 8,
    pattern_repeat_w_in: null,
    pattern_repeat_h_in: null,
  };
}

export function deriveFinishPhysicalScale(input: {
  croppedWidthIn?: number | null | undefined;
  patternRepeatIn?: { w: number; h: number } | null;
  stripePeriodIn?: number | null;
  sku?: string;
  family?: EcommerceFinishFamily;
}): FinishPhysicalScale {
  const sku = (input.sku ?? "").trim().toUpperCase();
  if (sku) return uniformFinishPhysicalScale(sku);
  if (input.family === "ultraleather") return uniformFinishPhysicalScale("FAB-BEA-ULT");
  if (input.family === "dekton") return uniformFinishPhysicalScale("DKT-ALDEM");
  if (input.family === "powder") return uniformFinishPhysicalScale("PWD-BLACK");
  if (input.stripePeriodIn === 7 || input.patternRepeatIn?.h === 7) {
    return uniformFinishPhysicalScale("FAB-CAB-CLA");
  }
  return uniformFinishPhysicalScale("FAB-CAN-WHI");
}

export function formatFinishRepeatScaleLabel(input: {
  sku: string;
  textureScale?: number | null;
  patternRepeatWIn?: number | null;
  patternRepeatHIn?: number | null;
  sampleWidthIn?: number | null;
  sampleHeightIn?: number | null;
}): string {
  const scale = deriveFinishPhysicalScale({ sku: input.sku });
  if (input.sku.trim().toUpperCase() === "FAB-CAB-CLA") {
    return `Stripe Repeat: ${scale.texture_scale}"`;
  }
  return `Tile: ${scale.sample_width_in}" × ${scale.sample_height_in}" · Scale: ${scale.texture_scale}`;
}

export function withCacheBustQuery(url: string, sha256: string): string {
  const sha8 = sha256.slice(0, 8);
  const bare = url.split("?")[0] ?? url;
  return `${bare}?v=${sha8}`;
}
