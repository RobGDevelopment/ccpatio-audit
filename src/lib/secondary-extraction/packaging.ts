import {
  CORRUGATE_COST_PER_SQFT,
  DEFAULT_PAD_IN,
  DIM_DIVISOR,
  EDGE_COST_PER_FT,
  FLAP_FACTOR,
  STRETCH_COST_PER_FT,
  WRAP_TURNS,
  type FgEnvelope,
  type PackagingResult,
} from "./types";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computePackaging(input: {
  envelope: FgEnvelope;
  padIn?: number;
  dimDivisor?: number;
  wrapTurns?: number;
}): PackagingResult {
  const pad = input.padIn ?? DEFAULT_PAD_IN;
  const dimDivisor = input.dimDivisor ?? DIM_DIVISOR;
  const wrapTurns = input.wrapTurns ?? WRAP_TURNS;

  const L = input.envelope.lengthIn + 2 * pad;
  const W = input.envelope.depthIn + 2 * pad;
  const H = input.envelope.heightIn + 2 * pad;

  const cartonSurfaceFt2 =
    (2 * (L * W + L * H + W * H) * FLAP_FACTOR) / 144;
  const edgeProtectorFt = (4 * (L + W)) / 12;
  const stretchWrapFt = ((2 * (L + W)) / 12) * wrapTurns;
  const dimWeightLbs = Math.ceil((L * W * H) / dimDivisor);

  const packCost = round4(
    cartonSurfaceFt2 * CORRUGATE_COST_PER_SQFT +
      edgeProtectorFt * EDGE_COST_PER_FT +
      stretchWrapFt * STRETCH_COST_PER_FT,
  );

  return {
    cartonIn: {
      l: round4(L),
      w: round4(W),
      h: round4(H),
    },
    lines: [
      {
        sku: "RM-PKG-CORRUGATE",
        qty: round4(cartonSurfaceFt2),
        uom: "sqft",
        role: "carton_wrap",
      },
      {
        sku: "RM-PKG-EDGE-BOARD",
        qty: round4(edgeProtectorFt),
        uom: "ft",
        role: "edge",
      },
      {
        sku: "RM-PKG-STRETCH",
        qty: round4(stretchWrapFt),
        uom: "ft",
        role: "wrap",
      },
    ],
    dimWeightLbs,
    dimDivisor,
    packCost,
  };
}
