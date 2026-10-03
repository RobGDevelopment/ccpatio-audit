export interface FedExFreightQuoteResponse {
  carrier: string;
  rate: number;
  days: number;
}

const FALLBACK_FREIGHT_MATRIX = [
  { region: "Southern California", zipPrefixes: ["90", "91", "92"], estimatedCost: 695.00, transitDays: 2 },
  { region: "Pacific Northwest", zipPrefixes: ["97", "98"], estimatedCost: 880.00, transitDays: 5 },
  { region: "Mountain West", zipPrefixes: ["80", "81", "84", "87", "88", "89"], estimatedCost: 740.00, transitDays: 3 },
  { region: "Texas / South Central", zipPrefixes: ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"], estimatedCost: 940.00, transitDays: 4 },
  { region: "Midwest", zipPrefixes: ["43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69"], estimatedCost: 960.00, transitDays: 5 },
  { region: "Southeast", zipPrefixes: ["27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39"], estimatedCost: 1150.00, transitDays: 6 },
  { region: "Northeast", zipPrefixes: ["0", "1"], estimatedCost: 1230.00, transitDays: 7 }
];

type ShadowLane = (typeof FALLBACK_FREIGHT_MATRIX)[number];

function matchShadowLane(destZip: string): ShadowLane & { matched: boolean } {
  const zip = destZip.trim();
  let match: { lane: ShadowLane; prefixLength: number } | null = null;
  for (const lane of FALLBACK_FREIGHT_MATRIX) {
    for (const prefix of lane.zipPrefixes) {
      if (!zip.startsWith(prefix)) continue;
      if (!match || prefix.length > match.prefixLength) {
        match = { lane, prefixLength: prefix.length };
      }
    }
  }
  if (match) return { ...match.lane, matched: true };
  const padded = FALLBACK_FREIGHT_MATRIX.reduce((highest, lane) =>
    lane.estimatedCost > highest.estimatedCost ? lane : highest,
  );
  return {
    region: "Unlisted destination",
    zipPrefixes: padded.zipPrefixes,
    estimatedCost: padded.estimatedCost,
    transitDays: padded.transitDays,
    matched: false,
  };
}

/**
 * Prepares a request to the FedEx Freight LTL API and retrieves a quote.
 * Currently returns a mocked response.
 */
export async function getFedExFreightQuote(
  originZip: string,
  destZip: string,
  weightLb: number,
  freightClass: string
): Promise<FedExFreightQuoteResponse> {
  const lane = matchShadowLane(destZip);
  const rate = Math.round(lane.estimatedCost * 0.95 * 100) / 100;

  return {
    carrier: 'FedEx Freight',
    rate,
    days: lane.transitDays,
  };
}
