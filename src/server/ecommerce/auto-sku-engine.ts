/**
 * Deterministic CC Patio FIN-/3P- SKU + display-name generator for the
 * Auto-SKU wizard. Collision checks are injected so unit tests stay pure.
 */

import {
  computeAluMsrp,
  DEFAULT_ALU_UPCHARGE_PCT,
  FRAME_POLICY_ALU10,
  FRAME_POLICY_RESALE,
  wooEcommercePrice,
  type FramePolicy,
} from "./alu10-pricing";

export type FacingMode = "standard" | "LS" | "RS";
export type HeightMode = "standard" | "BAR" | "CNT" | "DIN";
export type ProductOriginKind = "manufactured" | "third_party";

/** When Metal-Framed Make is selected, Woo Aluminum = Steel × 1.10. */
export function autoWooAluminumPrice(input: {
  origin: ProductOriginKind;
  steelBaseMsrp: number | null | undefined;
  metalFramedMake?: boolean;
  upchargePct?: number;
}): { framePolicy: FramePolicy; wooPrice: number | null } {
  if (input.origin === "third_party") {
    return {
      framePolicy: FRAME_POLICY_RESALE,
      wooPrice:
        input.steelBaseMsrp == null
          ? null
          : wooEcommercePrice({
              steelMsrp: Number(input.steelBaseMsrp),
              framePolicy: FRAME_POLICY_RESALE,
            }),
    };
  }
  const metal = input.metalFramedMake !== false;
  const policy = metal ? FRAME_POLICY_ALU10 : FRAME_POLICY_RESALE;
  return {
    framePolicy: policy,
    wooPrice:
      input.steelBaseMsrp == null
        ? null
        : wooEcommercePrice({
            steelMsrp: Number(input.steelBaseMsrp),
            framePolicy: policy,
            upchargePct: input.upchargePct ?? DEFAULT_ALU_UPCHARGE_PCT,
          }),
  };
}

export { computeAluMsrp, DEFAULT_ALU_UPCHARGE_PCT };

export type AutoSkuInput = {
  origin: ProductOriginKind;
  collectionCode: string;
  furnitureTypeCode: string;
  lengthIn: number | string | null;
  depthIn: number | string | null;
  heightIn?: number | string | null;
  backHeightIn?: number | string | null;
  seatHeightIn?: number | string | null;
  facing?: FacingMode;
  heightMode?: HeightMode;
  /** Resale token only (3P-...). */
  resaleToken?: string;
  collectionLabel: string;
  furnitureTypeLabel: string;
  msrp?: number | string | null;
};

export type AutoSkuResult = {
  sku: string;
  productName: string;
  sizeToken: string | null;
  suffix: string | null;
};

const RESERVED = new Set(["FIN", "FAB", "MIS", "RM", "PWD", "3P", "ASM", "SA", "FRM", "CSS"]);

function digits(value: number | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n));
}

function cleanCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function buildAutoSku(input: AutoSkuInput): AutoSkuResult {
  const col = cleanCode(input.collectionCode);
  const typ = cleanCode(input.furnitureTypeCode);
  if (!col || !typ) throw new Error("Collection and furniture type codes are required.");
  if (RESERVED.has(col) || RESERVED.has(typ)) {
    throw new Error(`Reserved code cannot be used in SKU (${col}/${typ}).`);
  }

  const facing = input.facing ?? "standard";
  const heightMode = input.heightMode ?? "standard";
  const len = digits(input.lengthIn);
  const dep = digits(input.depthIn);
  const sizeToken = len && dep ? `${len}X${dep}` : len ? len : null;

  const suffixParts: string[] = [];
  if (facing === "LS" || facing === "RS") suffixParts.push(facing);
  if (heightMode === "BAR" || heightMode === "CNT" || heightMode === "DIN") {
    suffixParts.push(heightMode);
  }
  const suffix = suffixParts.length ? suffixParts.join("-") : null;

  let sku: string;
  if (input.origin === "third_party") {
    const token = cleanCode(input.resaleToken ?? "");
    if (!token) throw new Error("Resale token is required for 3P SKUs.");
    if (RESERVED.has(token) || ["RM", "PWD", "FAB", "ASM", "SA"].some((p) => token === p || token.startsWith(`${p}-`))) {
      throw new Error(`Resale token uses a reserved prefix: ${token}`);
    }
    sku = `3P-${col}-${typ}-${token}`;
  } else {
    const base = sizeToken ? `FIN-${col}-${typ}-${sizeToken}` : `FIN-${col}-${typ}`;
    sku = suffix ? `${base}-${suffix}` : base;
  }

  const productName = buildProductName(input, sizeToken, facing, heightMode);
  return { sku, productName, sizeToken, suffix };
}

export function buildProductName(
  input: AutoSkuInput,
  sizeToken: string | null,
  facing: FacingMode,
  heightMode: HeightMode,
): string {
  const bits: string[] = [input.collectionLabel.trim(), input.furnitureTypeLabel.trim()];
  if (sizeToken) {
    const [l, d] = sizeToken.split("X");
    const h = digits(input.heightIn);
    const bh = digits(input.backHeightIn);
    const sh = digits(input.seatHeightIn);
    let dim = `${l}" x ${d}"`;
    if (h) dim = `${l}" x ${d}" x ${h}"`;
    if (bh) dim += " BH";
    else if (sh) dim += " SH";
    bits.push(dim);
  }
  if (facing === "LS") bits.push("Left-Side Facing");
  if (facing === "RS") bits.push("Right-Side Facing");
  if (heightMode === "BAR") bits.push("(BAR HEIGHT)");
  if (heightMode === "CNT") bits.push("(COUNTER HEIGHT)");
  if (heightMode === "DIN") bits.push("(DINING HEIGHT)");
  return bits.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export async function generateCollisionCheckedSku(
  input: AutoSkuInput,
  exists: (sku: string) => Promise<boolean>,
  maxAttempts = 20,
): Promise<AutoSkuResult & { collided: boolean; attempts: number }> {
  const primary = buildAutoSku(input);
  if (!(await exists(primary.sku))) {
    return { ...primary, collided: false, attempts: 1 };
  }
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    const alt = buildAutoSku({
      ...input,
      furnitureTypeCode: `${cleanCode(input.furnitureTypeCode)}${attempt}`,
    });
    // Prefer numeric size disambiguation when dims exist.
    const withTag =
      primary.sizeToken != null
        ? {
            ...primary,
            sku: `${primary.sku}-V${attempt}`,
            productName: `${primary.productName} (Variant ${attempt})`,
          }
        : alt;
    if (!(await exists(withTag.sku))) {
      return { ...withTag, collided: true, attempts: attempt };
    }
  }
  throw new Error(`Unable to allocate a free SKU after ${maxAttempts} attempts for ${primary.sku}`);
}
