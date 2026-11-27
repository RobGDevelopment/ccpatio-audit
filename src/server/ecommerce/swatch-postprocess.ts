/**
 * Runtime crop post-process (illumination + seamless) shared by Apply Crop API.
 * Reuses the ops CV pipeline so seed and live crop stay visually consistent.
 */
import {
  finalizeSeamlessTexture,
  flattenIllumination,
} from "../../../scripts/ops/lib/swatch-cv-pipeline";
import type { MaterialClass } from "@/server/ecommerce/finish-intake";

export function postprocessCroppedRgb(
  rgb: Buffer,
  size: number,
  opts: {
    materialClass?: MaterialClass | null;
    patternMode?: "solid" | "striped" | null;
  },
): Buffer {
  const striped = opts.patternMode === "striped";
  if (opts.materialClass === "dekton") {
    return flattenIllumination(rgb, size, "plane");
  }
  return finalizeSeamlessTexture(rgb, size, {
    striped,
    patternMode: striped ? "striped" : "solid",
  });
}
