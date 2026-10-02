import { RM_FAB_GENERIC } from "@/lib/heuristic-bom";

export type YardageEdge = {
  parentSku: string;
  childSku: string;
  quantity: number;
  scrapFactor: number;
};

export type YardageLine = {
  finSku: string;
  fabricSku: string;
  quantity: number;
};

export type HoldQuantityDecision =
  | { action: "patch"; quantity: number }
  | { action: "delete" }
  | { action: "refuse"; error: string };

const QTY_EPSILON = 0.0001;

export function roundYards(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isFabricSku(sku: string): boolean {
  return sku.startsWith("FAB-") || sku === RM_FAB_GENERIC;
}

/**
 * Walk approved BOM edges from each FIN-* line.
 * RM-FAB-GENERIC yards count toward the staff-selected FAB-*.
 * Any other FAB-* the staff did not select refuses the order.
 */
export function fabricYardsFromEdges(
  lines: YardageLine[],
  edges: YardageEdge[],
): { ok: true; byFabric: Map<string, number> } | { ok: false; error: string } {
  const byFabric = new Map<string, number>();

  for (const line of lines) {
    const finSku = line.finSku.trim().toUpperCase();
    const fabricSku = line.fabricSku.trim().toUpperCase();
    if (!finSku.startsWith("FIN-")) {
      return { ok: false, error: `${finSku} is not a FIN-* finished good.` };
    }
    if (!fabricSku.startsWith("FAB-")) {
      return { ok: false, error: `${fabricSku} is not a FAB-* fabric.` };
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return { ok: false, error: `${finSku} quantity must be greater than zero.` };
    }

    const leaves = collectFabricLeaves(finSku, edges);
    const foreign = [...leaves.keys()].filter(
      (sku) => sku !== fabricSku && sku !== RM_FAB_GENERIC,
    );
    if (foreign.length > 0) {
      return {
        ok: false,
        error: `${finSku} BOM includes ${foreign.join(", ")}, which was not selected.`,
      };
    }

    const selected = leaves.get(fabricSku) ?? 0;
    const generic = leaves.get(RM_FAB_GENERIC) ?? 0;
    const perUnit = selected + generic;
    if (perUnit <= 0) {
      return {
        ok: false,
        error: `${finSku} BOM has no yardage for ${fabricSku}.`,
      };
    }

    const yards = roundYards(perUnit * line.quantity);
    byFabric.set(fabricSku, roundYards((byFabric.get(fabricSku) ?? 0) + yards));
  }

  return { ok: true, byFabric };
}

function collectFabricLeaves(rootSku: string, edges: YardageEdge[]): Map<string, number> {
  const totals = new Map<string, number>();
  const childrenOf = new Map<string, YardageEdge[]>();
  for (const edge of edges) {
    const parent = edge.parentSku.trim().toUpperCase();
    const list = childrenOf.get(parent) ?? [];
    list.push({
      ...edge,
      parentSku: parent,
      childSku: edge.childSku.trim().toUpperCase(),
    });
    childrenOf.set(parent, list);
  }

  const walk = (sku: string, multiplier: number, trail: Set<string>) => {
    if (trail.has(sku)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(sku);
    for (const edge of childrenOf.get(sku) ?? []) {
      const factor = edge.quantity * (Number.isFinite(edge.scrapFactor) ? edge.scrapFactor : 1);
      const next = multiplier * factor;
      if (isFabricSku(edge.childSku)) {
        totals.set(edge.childSku, (totals.get(edge.childSku) ?? 0) + next);
        continue;
      }
      walk(edge.childSku, next, nextTrail);
    }
  };

  walk(rootSku.trim().toUpperCase(), 1, new Set());
  return totals;
}

export function nextHoldQuantity(current: number, yards: number): HoldQuantityDecision {
  if (!Number.isFinite(current) || current < 0) {
    return { action: "refuse", error: "Hold line quantity is not a number." };
  }
  if (!Number.isFinite(yards) || yards <= 0) {
    return { action: "refuse", error: "Relief yardage must be greater than zero." };
  }
  const next = roundYards(current - yards);
  if (next < -QTY_EPSILON) {
    return {
      action: "refuse",
      error: `Hold line has ${current} yards and this order needs ${yards}.`,
    };
  }
  if (next <= QTY_EPSILON) return { action: "delete" };
  return { action: "patch", quantity: next };
}
