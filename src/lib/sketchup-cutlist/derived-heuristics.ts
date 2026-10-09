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

export const ALUMINUM_DENSITY_LB_PER_IN3 = 0.098;
export const TIG_WIRE_LB_PER_IN = 0.0003;

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

  const validComps = components.filter((c) => c.material === "ALUM" || c.material === "STL");
  
  // Track joints per endpoint for LEG components
  // Each LEG has 2 endpoints: 0 for min on long axis, 1 for max on long axis.
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
            // determine which end of a intersects with b
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

  for (const [jointsOnMin, jointsOnMax] of legJoints.values()) {
    if (jointsOnMin === 0) capEa++;
    if (jointsOnMax === 0) capEa++;
  }

  const weldWireLb = parseFloat((weldInches * TIG_WIRE_LB_PER_IN).toFixed(4));

  return { jointCount, weldWireLb, fastenerEa, capEa };
}
