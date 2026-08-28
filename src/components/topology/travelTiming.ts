/**
 * Time-dilated beam travel — digital hops vs physical floor movement.
 */

export const TRAVEL_MS_DIGITAL_MIN = 300;
export const TRAVEL_MS_DIGITAL_MAX = 500;
export const TRAVEL_MS_PHYSICAL_MIN = 1500;
export const TRAVEL_MS_PHYSICAL_MAX = 2000;
export const TRAVEL_MS_EXTERNAL_DIGITAL = 400;
export const TRAVEL_MS_EXTERNAL_PHYSICAL = 1800;

/** Webhooks, middleware fan-outs, mirror sync pulses, payment clears */
const DIGITAL_EDGE_IDS = new Set([
  "e-ig-chat",
  "e-chat-hub",
  "e-phone-hub",
  "e-wa-hub",
  "e-sms-hub",
  "e-email-hub",
  "e-social-hub",
  "e-google-hub",
  "e-organic-hub",
  "e-hub-leads",
  "e-walkin-leads",
  "e-hub-trade",
  "e-hub-warranty",
  "e-az-produce",
  "e-ca-produce",
  "e-warranty-produce",
  "e-produce-az-ingress",
  "e-produce-ca-ingress",
  "e-produce-wr-ingress",
  "e-ingress-redis",
  "e-ingress-pg",
  "e-pg-inngest",
  "e-inngest-katana",
  "e-inngest-mfg",
  "e-katana-mfg-new",
  "e-katana-alloc",
  "e-katana-mfg-new",
  "e-alloc-outsourced",
  "e-alloc-procure",
  "e-alloc-chop",
  "e-procure-mfg-sync",
  "e-tube-mfg-purchasing",
  "e-pod-mfg-production",
  "e-deposit-qbo-gateway",
  "e-deposit-clover-gateway",
  "e-gateway-approval-az",
  "e-gateway-approval-ca",
  "e-delivery-qbo",
  "e-qbo-clover",
  "e-clover-ok",
  "e-ok-postcare",
  "e-delivery-postcare",
]);

/** CRM stage drags, human floor WIP, design handoffs, field survey */
const PHYSICAL_EDGE_PATTERNS = [
  /^e-leads-/,
  /^e-trade-/,
  /^e-az-/,
  /^e-ca-/,
  /^e-bom-/,
  /^e-survey-/,
  /^e-sketchup-/,
  /^e-cutlists-/,
  /^e-procure-stock/,
  /^e-outsourced-/,
  /^e-wc-/,
  /^e-qc-/,
  /^e-mfg-dispatch/,
  /^e-dispatch-/,
  /^e-az-produce-deposit/,
  /^e-ca-produce-deposit/,
];

export type TravelKind = "digital" | "physical" | "mixed";

export function classifyEdgeTravel(edgeId: string): TravelKind {
  if (DIGITAL_EDGE_IDS.has(edgeId)) return "digital";
  if (PHYSICAL_EDGE_PATTERNS.some((re) => re.test(edgeId))) return "physical";
  /* Default: short cross-zone hops lean digital; factory QC lean physical */
  if (edgeId.includes("dispatch") || edgeId.includes("delivery"))
    return "physical";
  if (edgeId.includes("ingress") || edgeId.includes("mirror")) return "digital";
  return "physical";
}

export function travelMsForEdge(edgeId: string): number {
  const kind = classifyEdgeTravel(edgeId);
  if (kind === "digital") {
    return TRAVEL_MS_DIGITAL_MIN + (edgeId.length % 3) * 60;
  }
  return TRAVEL_MS_PHYSICAL_MIN + (edgeId.length % 5) * 100;
}

/** Aggregate travel duration for a step's edge bundle */
export function travelMsForEdges(edgeIds: string[]): number {
  if (edgeIds.length === 0) return TRAVEL_MS_PHYSICAL_MIN;
  const kinds = edgeIds.map(classifyEdgeTravel);
  const allDigital = kinds.every((k) => k === "digital");
  const allPhysical = kinds.every((k) => k === "physical");

  if (allDigital) {
    return Math.min(
      TRAVEL_MS_DIGITAL_MAX,
      Math.max(TRAVEL_MS_DIGITAL_MIN, ...edgeIds.map(travelMsForEdge))
    );
  }
  if (allPhysical) {
    return Math.max(...edgeIds.map(travelMsForEdge), TRAVEL_MS_PHYSICAL_MIN);
  }
  /* Mixed bundle — weighted toward slower human leg */
  const max = Math.max(...edgeIds.map(travelMsForEdge));
  return Math.min(TRAVEL_MS_PHYSICAL_MAX, max);
}

export function externalTravelMs(edgeIds: string[]): number {
  const base = travelMsForEdges(edgeIds);
  const kind = edgeIds.some((e) => classifyEdgeTravel(e) === "physical")
    ? "physical"
    : "digital";
  return kind === "digital"
    ? Math.max(TRAVEL_MS_EXTERNAL_DIGITAL, base)
    : Math.max(TRAVEL_MS_EXTERNAL_PHYSICAL, base);
}
