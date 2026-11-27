/**
 * Pure helpers for the Tab 1 Intake & Media Studio 1:1 cropper.
 *
 * The crop is a SQUARE in SOURCE pixels. On a non-square photo (3:2, 4:3, …) a square
 * must be positioned with per-axis percentages — width% uses sourceWidth, height% uses
 * sourceHeight — otherwise the overlay drifts off the pixels that `sharp.extract` will cut:
 *
 *   left%   = (cropX      / sourceWidth)  * 100
 *   top%    = (cropY      / sourceHeight) * 100
 *   width%  = (cropSidePx / sourceWidth)  * 100
 *   height% = (cropSidePx / sourceHeight) * 100
 */

export type CropBox = {
  cropX: number;
  cropY: number;
  cropSidePx: number;
};

export type CropGeometry = CropBox & {
  sourceWidth: number;
  sourceHeight: number;
};

export type CssPercentBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Minimum square side (px) the server accepts for promote (see promoteFinishIntake: < 64 rejected). */
export const MIN_CROP_SIDE_PX = 64;

export function cropBoxToCssPercent(input: CropGeometry): CssPercentBox {
  const { cropX, cropY, cropSidePx, sourceWidth, sourceHeight } = input;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  return {
    left: (cropX / sourceWidth) * 100,
    top: (cropY / sourceHeight) * 100,
    width: (cropSidePx / sourceWidth) * 100,
    height: (cropSidePx / sourceHeight) * 100,
  };
}

/**
 * Inverse of {@link cropBoxToCssPercent}. Uses `width%` to recover the side
 * (width% * sourceWidth) — height% is redundant for a square and ignored.
 * Result is rounded to whole source pixels (what the DB / sharp expect).
 */
export function cssPercentToCropBox(input: {
  left: number;
  top: number;
  width: number;
  sourceWidth: number;
  sourceHeight: number;
}): CropBox {
  const { left, top, width, sourceWidth, sourceHeight } = input;
  return {
    cropX: Math.round((left / 100) * sourceWidth),
    cropY: Math.round((top / 100) * sourceHeight),
    cropSidePx: Math.round((width / 100) * sourceWidth),
  };
}

/** Largest centered square that fits in the source. */
export function defaultCenteredCrop(sourceWidth: number, sourceHeight: number): CropBox {
  const side = Math.max(1, Math.floor(Math.min(sourceWidth, sourceHeight)));
  return {
    cropX: Math.floor((sourceWidth - side) / 2),
    cropY: Math.floor((sourceHeight - side) / 2),
    cropSidePx: side,
  };
}

/**
 * Clamp a square into the source bounds. Side is capped at min(W, H) and at the
 * room left to the right/bottom edges; never below `minSide` (or the shorter edge if smaller).
 */
export function clampCropBox(
  box: CropBox,
  sourceWidth: number,
  sourceHeight: number,
  minSide: number = MIN_CROP_SIDE_PX,
): CropBox {
  const shortEdge = Math.max(1, Math.floor(Math.min(sourceWidth, sourceHeight)));
  const floorSide = Math.min(minSide, shortEdge);
  const side = Math.round(Math.max(floorSide, Math.min(box.cropSidePx, shortEdge)));
  const cropX = Math.round(Math.max(0, Math.min(box.cropX, sourceWidth - side)));
  const cropY = Math.round(Math.max(0, Math.min(box.cropY, sourceHeight - side)));
  return { cropX, cropY, cropSidePx: side };
}

/** Largest side that still fits when the box is anchored at (cropX, cropY). */
export function maxSideFromAnchor(
  cropX: number,
  cropY: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return Math.max(1, Math.floor(Math.min(sourceWidth - cropX, sourceHeight - cropY)));
}

/** Tokens that keep their canonical all-caps spelling in storefront display names. */
export const STOREFRONT_UPPERCASE_TOKENS: ReadonlySet<string> = new Set([
  "BH",
  "SH",
  "OD",
  "LED",
  "II",
  "III",
]);

/** Category-accurate Display Name placeholders — never "Canvas Ivory" on Dekton/Powder. */
export function displayNamePlaceholderForMaterial(
  materialClass: "sunbrella" | "ultraleather" | "dekton" | "powder" | "addon" | "" | null | undefined,
): string {
  switch (materialClass) {
    case "sunbrella":
      return "e.g. Cabana Classic";
    case "ultraleather":
      return "e.g. Beacon";
    case "dekton":
      return "e.g. Aura 15";
    case "powder":
      return "e.g. Gray";
    case "addon":
      return "e.g. Canvas Ivory";
    default:
      return "e.g. Storefront name";
  }
}

/**
 * Storefront Title Case: "canvas ivory" → "Canvas Ivory"; "BH ii" → "BH II".
 * BH / SH / OD / LED / II / III are always upper-cased. Hyphen/slash-separated parts
 * are cased independently; whitespace is trimmed and collapsed.
 */
export function titleCaseStorefront(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed.replace(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g, (token) => {
    const upper = token.toUpperCase();
    if (STOREFRONT_UPPERCASE_TOKENS.has(upper)) return upper;
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  });
}
