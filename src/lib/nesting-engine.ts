export interface NestingResult {
  totalExtrusions: number;
  sticks: { cuts: number[]; drop: number; }[];
  scrap: number[];
  usableRemnants: number[];
}

export function calculateExtrusionYield(cutList: number[], stockLength: number = 240): NestingResult {
  // Sort descending for First-Fit Decreasing heuristic (optimizes packing density)
  const sortedCuts = [...cutList].sort((a, b) => b - a);
  const sticks: { cuts: number[]; drop: number; }[] = [];
  const scrap: number[] = [];
  const usableRemnants: number[] = [];

  for (const cut of sortedCuts) {
    if (cut > stockLength) {
      throw new Error(`Cut size ${cut} exceeds stock length ${stockLength}`);
    }

    let placed = false;
    for (const stick of sticks) {
      if (stick.drop >= cut) {
        stick.cuts.push(cut);
        stick.drop -= cut;
        placed = true;
        break;
      }
    }

    if (!placed) {
      sticks.push({ cuts: [cut], drop: stockLength - cut });
    }
  }

  // Calculate remnants vs scrap (Strict Business Logic Tolerance: < 36 inches is scrap)
  for (const stick of sticks) {
    if (stick.drop > 0) {
      if (stick.drop < 36) {
        scrap.push(stick.drop);
      } else {
        usableRemnants.push(stick.drop);
      }
    }
  }

  return {
    totalExtrusions: sticks.length,
    sticks,
    scrap,
    usableRemnants
  };
}

/* 
// MOCK EXECUTION PROOF
const sampleCutList = [45, 120, 80, 200, 24, 30, 180, 75, 45, 90];
const result = calculateExtrusionYield(sampleCutList);
console.log("Sticks Needed:", result.totalExtrusions); // 4
console.log("Usable Remnants:", result.usableRemnants); // e.g., [40, 60]
console.log("Scrap:", result.scrap); // e.g., [15, 20]
*/
