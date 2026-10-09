import type { ProfileType } from "./component-hygiene";

const OUTSIDE_PERIMETERS: Record<ProfileType, number> = {
  "SQ2-16": 8,
  "SQ2x1-16": 6,
  "RT1.5x0.75-16": 4.5,
  "FB0.125x1.5": 3.25,
};

const PROFILE_AREAS: Record<ProfileType, number> = {
  "SQ2-16": 0.4656,
  "SQ2x1-16": 0.3456,
  "RT1.5x0.75-16": 0.2556,
  "FB0.125x1.5": 0.1875,
};

const CAP_SKUS: Record<string, string> = {
  "SQ2-16": "RM-PLASTIC-CAP-2X2",
  "SQ2x1-16": "RM-PLASTIC-CAP-2X1",
  "RT1.5x0.75-16": "RM-PLASTIC-CAP-15X075",
};

export const ALUMINUM_DENSITY_LB_PER_IN3 = 0.098;
export const TIG_WIRE_LB_PER_IN = 0.0003;
export const ARGON_CF_PER_JOINT = 0.15;
export const SAND_LB_PER_SQFT = 0.15;

export function calculatePowder(
  components: Array<{ profile: ProfileType; lengthIn: number; qtyEa?: number }>,
  coverageSqftPerLb: number = 4
) {
  let surfaceFt2 = 0;
  for (const comp of components) {
    const qty = comp.qtyEa ?? 1;
    const perimeter = OUTSIDE_PERIMETERS[comp.profile];
    if (perimeter) {
      surfaceFt2 += (perimeter * comp.lengthIn * qty) / 144;
    }
  }
  const pounds = parseFloat((surfaceFt2 / coverageSqftPerLb).toFixed(4));
  return {
    surfaceFt2: parseFloat(surfaceFt2.toFixed(4)),
    pounds,
    method: "coverage" as const,
  };
}

export function calculateWeight(
  components: Array<{ material: string; profile: ProfileType; lengthIn: number; qtyEa?: number; name: string }>
) {
  let aluminumLbs = 0;
  const excludedNames: string[] = [];

  for (const comp of components) {
    if (comp.material !== "ALUM") {
      excludedNames.push(comp.name);
      continue;
    }
    const qty = comp.qtyEa ?? 1;
    const area = PROFILE_AREAS[comp.profile];
    if (area) {
      const volume = area * comp.lengthIn * qty;
      aluminumLbs += volume * ALUMINUM_DENSITY_LB_PER_IN3;
    }
  }
  return {
    aluminumLbs: parseFloat(aluminumLbs.toFixed(4)),
    aluminumPlfLbs: null,
    excludedNames,
  };
}

function boxesIntersect(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
  pad: number
): boolean {
  return (
    a.min[0] - pad <= b.max[0] + pad &&
    a.max[0] + pad >= b.min[0] - pad &&
    a.min[1] - pad <= b.max[1] + pad &&
    a.max[1] + pad >= b.min[1] - pad &&
    a.min[2] - pad <= b.max[2] + pad &&
    a.max[2] + pad >= b.min[2] - pad
  );
}

function getLongAxis(min: [number, number, number], max: [number, number, number]): 0 | 1 | 2 {
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  if (dx >= dy && dx >= dz) return 0;
  if (dy >= dx && dy >= dz) return 1;
  return 2;
}

export function calculateJoinery(
  components: Array<{
    material: string;
    profile: ProfileType;
    aabb: { min: [number, number, number]; max: [number, number, number] };
    role?: string;
    endA?: string | null;
    endB?: string | null;
  }>
) {
  let jointCount = 0;
  let weldInches = 0;
  let fastenerEa = 0;
  let capEa = 0;
  const capsMap = new Map<string, number>();

  const validComps = components.filter((c) => c.material === "ALUM" || c.material === "STL");
  
  const legJoints = new Map<number, [number, number]>();

  for (let i = 0; i < validComps.length; i++) {
    if (validComps[i].role === "LEG") {
      legJoints.set(i, [0, 0]);
    }
  }

  for (let i = 0; i < validComps.length; i++) {
    for (let j = i + 1; j < validComps.length; j++) {
      const a = validComps[i];
      const b = validComps[j];

      if (boxesIntersect(a.aabb, b.aabb, 0.125)) {
        const axisA = getLongAxis(a.aabb.min, a.aabb.max);
        const axisB = getLongAxis(b.aabb.min, b.aabb.max);

        if (axisA !== axisB) {
          jointCount++;

          const perimA = OUTSIDE_PERIMETERS[a.profile] || 0;
          const perimB = OUTSIDE_PERIMETERS[b.profile] || 0;
          weldInches += Math.min(perimA, perimB);

          const aIsLeg = a.role === "LEG";
          const aIsFrmRail = a.role === "FRM" || a.role === "RAIL";
          const bIsLeg = b.role === "LEG";
          const bIsFrmRail = b.role === "FRM" || b.role === "RAIL";

          const aEnds90 = a.endA === "90" && a.endB === "90";
          const bEnds90 = b.endA === "90" && b.endB === "90";

          if ((aIsLeg && bIsFrmRail && aEnds90 && bEnds90) || (bIsLeg && aIsFrmRail && bEnds90 && aEnds90)) {
            fastenerEa += 2;
          }

          if (aIsLeg) {
            const midB = (b.aabb.min[axisA] + b.aabb.max[axisA]) / 2;
            const distMin = Math.abs(a.aabb.min[axisA] - midB);
            const distMax = Math.abs(a.aabb.max[axisA] - midB);
            const endpointIndex = distMin < distMax ? 0 : 1;
            const joints = legJoints.get(i)!;
            joints[endpointIndex]++;
          }
          if (bIsLeg) {
            const midA = (a.aabb.min[axisB] + a.aabb.max[axisB]) / 2;
            const distMin = Math.abs(b.aabb.min[axisB] - midA);
            const distMax = Math.abs(b.aabb.max[axisB] - midA);
            const endpointIndex = distMin < distMax ? 0 : 1;
            const joints = legJoints.get(j)!;
            joints[endpointIndex]++;
          }
        }
      }
    }
  }

  for (const [legIndex, [jointsOnMin, jointsOnMax]] of legJoints.entries()) {
    if (jointsOnMin === 0) {
      capEa++;
      const profile = validComps[legIndex].profile;
      const sku = CAP_SKUS[profile];
      if (sku) capsMap.set(sku, (capsMap.get(sku) || 0) + 1);
    }
    if (jointsOnMax === 0) {
      capEa++;
      const profile = validComps[legIndex].profile;
      const sku = CAP_SKUS[profile];
      if (sku) capsMap.set(sku, (capsMap.get(sku) || 0) + 1);
    }
  }

  const weldWireLb = parseFloat((weldInches * TIG_WIRE_LB_PER_IN).toFixed(4));
  const caps = Array.from(capsMap.entries()).map(([sku, ea]) => ({ sku, ea }));

  return { jointCount, weldWireLb, fastenerEa, capEa, caps };
}

export function calculateArgon(jointCount: number) {
  return {
    jointCount,
    cubicFeet: parseFloat((jointCount * ARGON_CF_PER_JOINT).toFixed(4))
  };
}

export function calculateSand(
  components: Array<{ profile: ProfileType; lengthIn: number; qtyEa?: number; material: string; name: string }>
) {
  let surfaceFt2 = 0;
  const excludedNames: string[] = [];
  
  for (const comp of components) {
    if (comp.material !== "ALUM" && comp.material !== "STL") continue;
    const qty = comp.qtyEa ?? 1;
    const perimeter = OUTSIDE_PERIMETERS[comp.profile];
    if (perimeter) {
      surfaceFt2 += (perimeter * comp.lengthIn * qty) / 144;
    } else {
      excludedNames.push(comp.name);
    }
  }
  
  const pounds = parseFloat((surfaceFt2 * SAND_LB_PER_SQFT).toFixed(4));
  return {
    surfaceFt2: parseFloat(surfaceFt2.toFixed(4)),
    pounds,
    excludedNames
  };
}

export function calculateFreight(
  unionAabb: { min: [number, number, number]; max: [number, number, number] } | null,
  aluminumLbs: number
) {
  if (!unionAabb || unionAabb.min[0] === Infinity || unionAabb.max[0] === -Infinity) {
    return {
      reason: "degenerate_aabb" as const,
      lIn: 0, wIn: 0, hIn: 0,
      skidBoardFt: 0, strapFt: 0, shrinkSqft: 0,
      grossFreightLbs: aluminumLbs,
      dimWeightLbs: 0
    };
  }

  const dx = unionAabb.max[0] - unionAabb.min[0];
  const dy = unionAabb.max[1] - unionAabb.min[1];
  const dz = unionAabb.max[2] - unionAabb.min[2];

  if (dx <= 0 || dy <= 0 || dz <= 0) {
    return {
      reason: "degenerate_aabb" as const,
      lIn: 0, wIn: 0, hIn: 0,
      skidBoardFt: 0, strapFt: 0, shrinkSqft: 0,
      grossFreightLbs: aluminumLbs,
      dimWeightLbs: 0
    };
  }

  const extents = [dx, dy, dz].sort((a, b) => b - a);
  const footL = extents[0];
  const footW = extents[1];
  const hIn = extents[2];

  const loadH = hIn + 6;
  const dimWeightLbs = Math.ceil((footL * footW * loadH) / 139);

  if (footL > 192 || footW > 192) {
    return {
      reason: "oversize_no_single_skid" as const,
      lIn: footL, wIn: footW, hIn,
      skidBoardFt: 0, strapFt: 0, shrinkSqft: 0,
      grossFreightLbs: aluminumLbs,
      dimWeightLbs
    };
  }

  const deckCount = Math.max(2, Math.ceil(footL / 12) + 1);
  const skidBoardFt = 3 * (4 * 4 * footL) / 144 + deckCount * (2 * 4 * footW) / 144;
  const skidLumberLbs = skidBoardFt * 2.5;
  const girthFt = (2 * (footW + hIn + 6) + 12) / 12;
  const lengthFt = (2 * (footL + hIn + 6) + 12) / 12;
  const strapFt = 2 * girthFt + 2 * lengthFt;
  const shrinkSqft = 2 * (footL * footW + footL * loadH + footW * loadH) * 1.25 / 144;

  const grossFreightLbs = aluminumLbs + skidLumberLbs;

  return {
    lIn: footL, wIn: footW, hIn,
    skidBoardFt: parseFloat(skidBoardFt.toFixed(4)),
    strapFt: parseFloat(strapFt.toFixed(4)),
    shrinkSqft: parseFloat(shrinkSqft.toFixed(4)),
    grossFreightLbs: parseFloat(grossFreightLbs.toFixed(4)),
    dimWeightLbs
  };
}

export function calculateCushionPackage(
  mode: "standard" | "vacuum_compressed",
  cushionAabb: { min: [number, number, number]; max: [number, number, number] } | null
) {
  if (!cushionAabb || cushionAabb.min[0] === Infinity || cushionAabb.max[0] === -Infinity) {
    return { lines: [], labor: { setup: 0, run: 0, notes: "" }, compressed: { l: 0, w: 0, h: 0 } };
  }
  
  const dx = cushionAabb.max[0] - cushionAabb.min[0];
  const dy = cushionAabb.max[1] - cushionAabb.min[1];
  const dz = cushionAabb.max[2] - cushionAabb.min[2];

  if (dx <= 0 || dy <= 0 || dz <= 0) {
    return { lines: [], labor: { setup: 0, run: 0, notes: "" }, compressed: { l: 0, w: 0, h: 0 } };
  }

  const extents = [dx, dy, dz].sort((a, b) => b - a);
  const footL = extents[0];
  const footW = extents[1];
  const cushionH = extents[2];

  if (mode === "standard") {
    return {
      lines: [{ sku: "RM-PKG-CORRUGATE-OS", qty: 1, uom: "ea", notes: "CUSHION_MODE:standard" }],
      labor: { setup: 0, run: 4.0, notes: "CUSHION_MODE:standard" },
      compressed: { l: footL, w: footW, h: cushionH }
    };
  }

  const compressedH = Math.max(2, cushionH * 0.35);
  const boardft = (1.5 * footL * footW) / 144;
  const shrinkSqft = 2 * (footL * footW + footL * compressedH + footW * compressedH) * 1.25 / 144;

  return {
    lines: [
      { sku: "RM-PKG-DUNNAGE-15", qty: parseFloat(boardft.toFixed(4)), uom: "boardft", notes: "CUSHION_MODE:vacuum_compressed" },
      { sku: "RM-PKG-SHRINK", qty: parseFloat(shrinkSqft.toFixed(4)), uom: "sqft", notes: "cushion" }
    ],
    labor: { setup: 2, run: 6, notes: "CUSHION_MODE:vacuum_compressed" },
    compressed: { l: footL, w: footW, h: compressedH }
  };
}
