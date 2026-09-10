import {
  FOAM_THICKNESS_IN,
  HARDWARE_LB_EACH,
  type DraftLineInput,
  type PhysicsFactor,
  type WeightBreakdown,
} from "./types";
import {
  sumCutListFeet,
  sumMetalAreaFt2,
} from "./parse-notes";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function factorFor(
  factors: PhysicsFactor[],
  sku: string,
  profileCode?: string,
): PhysicsFactor | undefined {
  const upper = sku.toUpperCase();
  if (profileCode) {
    const exact = factors.find(
      (f) =>
        f.materialSku === upper &&
        f.profileCode.toUpperCase() === profileCode.toUpperCase(),
    );
    if (exact) return exact;
  }
  return (
    factors.find((f) => f.materialSku === upper && f.profileCode === "") ??
    factors.find((f) => f.materialSku === upper)
  );
}

function weightPlf(factor: PhysicsFactor | undefined): number {
  if (!factor) return 0;
  if (factor.attrWeightPlf != null && factor.attrWeightPlf > 0) {
    return factor.attrWeightPlf;
  }
  return factor.weightPlf ?? 0;
}

function isMetalSku(sku: string): boolean {
  const s = sku.toUpperCase();
  return s.includes("MET") || s.includes("TUBING") || s.startsWith("RM-MET");
}

function isFoamSku(sku: string): boolean {
  return sku.toUpperCase().includes("FOAM");
}

function isFabricSku(sku: string): boolean {
  const s = sku.toUpperCase();
  return s.includes("FAB") || s.startsWith("FAB-");
}

function isPowderSku(sku: string): boolean {
  return sku.toUpperCase().includes("PWD") || sku.toUpperCase().includes("POWDER");
}

function isHardwareSku(sku: string, uom: string): boolean {
  const s = sku.toUpperCase();
  if (uom.toLowerCase() !== "ea") return false;
  return (
    s.includes("HW") ||
    s.includes("CAP") ||
    s.includes("BOLT") ||
    s.includes("SCREW") ||
    s.includes("FASTENER")
  );
}

export function computeWeight(input: {
  lines: DraftLineInput[];
  factors: PhysicsFactor[];
  foamThicknessIn?: number;
}): { estWeightLbs: number; breakdown: WeightBreakdown } {
  const foamT = input.foamThicknessIn ?? FOAM_THICKNESS_IN;
  const breakdown: WeightBreakdown = {
    metal: 0,
    foam: 0,
    fabric: 0,
    powder: 0,
    hardware: 0,
  };

  let metalAreaFt2 = 0;

  for (const line of input.lines) {
    const scrap = line.scrapFactor > 0 ? line.scrapFactor : 1;
    const factor = factorFor(
      input.factors,
      line.childSku,
      line.cutList[0]?.profileCode,
    );
    const uom = line.unitOfMeasure.toLowerCase();

    if (isMetalSku(line.childSku) && (uom === "ft" || line.cutList.length > 0)) {
      const tubeFt =
        line.cutList.length > 0
          ? sumCutListFeet(line.cutList)
          : line.quantity;
      const plf = weightPlf(factor) || 0.91;
      breakdown.metal += tubeFt * scrap * plf;
      const peri = factor?.perimeterIn ?? 8;
      metalAreaFt2 +=
        line.cutList.length > 0
          ? sumMetalAreaFt2(line.cutList, peri) * scrap
          : ((peri * (tubeFt * 12)) / 144) * scrap;
      continue;
    }

    if (isFoamSku(line.childSku)) {
      const boardFt = line.quantity;
      const volumeFt3 = boardFt * (foamT / 12);
      const density = factor?.densityPcf ?? 1.8;
      breakdown.foam += volumeFt3 * density * scrap;
      continue;
    }

    if (isFabricSku(line.childSku) && (uom === "yd" || uom === "yds")) {
      const yards = line.quantity;
      const widthIn = factor?.fabricWidthIn ?? 54;
      const oz = factor?.ozPerYd2 ?? 11.5;
      const areaYd2 = yards * (widthIn / 36);
      breakdown.fabric += areaYd2 * (oz / 16) * scrap;
      continue;
    }

    if (isPowderSku(line.childSku)) {
      const coverage = factor?.coverageSqftPerLb ?? 4;
      if (line.unitOfMeasure.toLowerCase() === "lb" && line.quantity > 0) {
        breakdown.powder += line.quantity * scrap;
      } else if (coverage > 0 && metalAreaFt2 > 0) {
        breakdown.powder += metalAreaFt2 / coverage;
      }
      continue;
    }

    if (isHardwareSku(line.childSku, uom)) {
      breakdown.hardware += line.quantity * HARDWARE_LB_EACH * scrap;
    }
  }

  // Powder from area if no powder line qty and we have metal area
  if (breakdown.powder === 0 && metalAreaFt2 > 0) {
    const pwd = factorFor(input.factors, "RM-PWD-GENERIC");
    const coverage = pwd?.coverageSqftPerLb ?? 4;
    if (coverage > 0) breakdown.powder = metalAreaFt2 / coverage;
  }

  for (const key of Object.keys(breakdown) as (keyof WeightBreakdown)[]) {
    breakdown[key] = round4(breakdown[key]);
  }

  const estWeightLbs = round4(
    breakdown.metal +
      breakdown.foam +
      breakdown.fabric +
      breakdown.powder +
      breakdown.hardware,
  );

  return { estWeightLbs, breakdown };
}
