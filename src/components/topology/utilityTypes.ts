/**
 * MP&E utility classification — pipes color-coded by payload + hierarchical grid level.
 */

export type UtilityKind = "digital" | "physical" | "financial" | "comms";

/** Site-plan pipe hierarchy: mains → street → building */
export type GridLevel = "trunk" | "branch" | "local";

export const UTILITY_COLORS: Record<
  UtilityKind,
  { stroke: string; glow: string; label: string }
> = {
  digital: {
    stroke: "#22d3ee",
    glow: "rgba(34,211,238,0.55)",
    label: "Digital / API",
  },
  physical: {
    stroke: "#fbbf24",
    glow: "rgba(251,191,36,0.5)",
    label: "Physical / WIP",
  },
  financial: {
    stroke: "#34d399",
    glow: "rgba(52,211,153,0.5)",
    label: "Financial",
  },
  comms: {
    stroke: "#a78bfa",
    glow: "rgba(167,139,250,0.5)",
    label: "Comms",
  },
};

/** Stroke widths by snake-tray hierarchy (px) */
export const GRID_STROKE: Record<GridLevel, number> = {
  trunk: 6,
  branch: 3,
  local: 1.5,
};

export const GRID_GLOW_EXTRA: Record<GridLevel, number> = {
  trunk: 4,
  branch: 2.5,
  local: 1.5,
};

/** Explicit overrides — otherwise inferred from edge id patterns */
const UTILITY_BY_EDGE_ID: Record<string, UtilityKind> = {
  "e-az-produce-deposit-qbo": "financial",
  "e-az-produce-deposit-clover": "financial",
  "e-ca-produce-deposit-qbo": "financial",
  "e-ca-produce-deposit-clover": "financial",
  "e-deposit-qbo-gateway": "financial",
  "e-deposit-clover-gateway": "financial",
  "e-gateway-approval-az": "financial",
  "e-gateway-approval-ca": "financial",
  "e-delivery-qbo": "financial",
  "e-qbo-clover": "financial",
  "e-clover-ok": "financial",
  "e-ig-chat": "comms",
  "e-chat-hub": "comms",
  "e-phone-hub": "comms",
  "e-wa-hub": "comms",
  "e-sms-hub": "comms",
  "e-email-hub": "comms",
  "e-social-hub": "comms",
  "e-google-hub": "comms",
  "e-organic-hub": "comms",
  "e-walkin-leads": "physical",
};

const FINANCIAL_RE =
  /qbo|clover|deposit|payment|gateway|reconciled|invoice|fuzzy/i;
const COMMS_RE = /phone|sms|whatsapp|webchat|email|social|ig-chat|wa-hub|chat/i;
const PHYSICAL_RE =
  /wc-|work-center|qc-|dispatch|delivery|survey|sketchup|cutlist|bom|chop|tube|outsourced|alloc-chop|procure-stock|marriage|sandblast|powder|upholstery/i;
const DIGITAL_RE =
  /ingress|redis|postgres|inngest|katana|produce|webhook|hub-leads|hub-trade|hub-warranty|mfg|mirror|alloc|sync|mo_create/i;

export function classifyUtility(
  edgeId: string,
  explicit?: UtilityKind | null
): UtilityKind {
  if (explicit) return explicit;
  if (UTILITY_BY_EDGE_ID[edgeId]) return UTILITY_BY_EDGE_ID[edgeId];
  if (FINANCIAL_RE.test(edgeId)) return "financial";
  if (COMMS_RE.test(edgeId)) return "comms";
  if (PHYSICAL_RE.test(edgeId)) return "physical";
  if (DIGITAL_RE.test(edgeId)) return "digital";
  return "digital";
}

/**
 * Building → city (zone) membership for hierarchical routing.
 * Granular stage ids (`parent__stage`) inherit the parent's zone.
 */
const NODE_ZONE: Record<string, string> = {
  "traffic-meta": "z0",
  "traffic-google": "z0",
  "traffic-organic": "z0",
  "chan-phone": "z0",
  "chan-sms": "z0",
  "chan-whatsapp": "z0",
  "chan-webchat": "z0",
  "chan-email": "z0",
  "chan-social": "z0",
  "showroom-walkin": "z0",
  "ghl-hub": "z1",
  "leads-pipe": "z2",
  "trade-pipe": "z2",
  "warranty-pipe": "z2",
  "sales-az": "z3",
  "sales-ca": "z3",
  "produce-az": "z3",
  "produce-ca": "z3",
  "produce-warranty": "z3",
  "field-survey": "z4",
  sketchup: "z4",
  "cut-lists": "z4",
  "bom-packet": "z4",
  "qbo-deposit-link": "z4",
  "clover-showroom": "z4",
  "payment-gateway": "z4",
  ingress: "z5",
  redis: "z5",
  postgres: "z5",
  inngest: "z5",
  katana: "z5",
  "inventory-alloc": "z5",
  "procurement-wait": "z5",
  "outsourced-accessories": "z5",
  "work-centers": "z6",
  "qc-gates": "z6",
  "mfg-pipe": "z6",
  "dispatch-routes": "z7",
  delivery: "z7",
  qbo: "z8",
  clover: "z8",
  reconciled: "z8",
  postcare: "z8",
};

const OPERATIONAL_NODE_ZONE = new Map<string, string>();

export function registerOperationalNodeZones(
  entries: Iterable<[string, string]> | Map<string, string>
): void {
  OPERATIONAL_NODE_ZONE.clear();
  for (const [id, zone] of entries) {
    OPERATIONAL_NODE_ZONE.set(id, zone);
  }
}

export function zoneOfNode(nodeId: string): string | null {
  if (/^z[0-8]$/.test(nodeId)) return nodeId;
  const gridTie = nodeId.match(/^gt-(?:in|out)-(z[0-8])$/);
  if (gridTie) return gridTie[1]!;
  const base = nodeId.includes("__") ? nodeId.split("__")[0]! : nodeId;
  return (
    NODE_ZONE[base] ??
    OPERATIONAL_NODE_ZONE.get(nodeId) ??
    OPERATIONAL_NODE_ZONE.get(base) ??
    null
  );
}

/** Explicit grid-level overrides */
const GRID_LEVEL_BY_EDGE: Record<string, GridLevel> = {
  /* Local — design stack & middleware internals */
  "e-survey-sketchup": "local",
  "e-sketchup-cutlists": "local",
  "e-cutlists-bom": "local",
  "e-ingress-redis": "local",
  "e-ingress-pg": "local",
  "e-pg-inngest": "local",
  "e-qbo-clover": "local",
  "e-clover-ok": "local",
  "e-wc-qc": "local",
  "e-wc-flow": "local",
  /* Branch — street tees inside / at city edge */
  "e-ig-chat": "branch",
  "e-chat-hub": "branch",
  "e-phone-hub": "branch",
  "e-wa-hub": "branch",
  "e-sms-hub": "branch",
  "e-email-hub": "branch",
  "e-social-hub": "branch",
  "e-google-hub": "branch",
  "e-organic-hub": "branch",
  "e-deposit-qbo-gateway": "branch",
  "e-deposit-clover-gateway": "branch",
  "e-katana-alloc": "branch",
  "e-alloc-procure": "branch",
  "e-alloc-outsourced": "branch",
  "e-qc-mfg": "branch",
};

/**
 * trunk = zone↔zone mains · branch = street tees · local = building↔building
 */
export function classifyGridLevel(
  edgeId: string,
  sourceId: string,
  targetId: string,
  explicit?: GridLevel | null
): GridLevel {
  if (explicit) return explicit;
  if (GRID_LEVEL_BY_EDGE[edgeId]) return GRID_LEVEL_BY_EDGE[edgeId];

  const srcBase = sourceId.includes("__") ? sourceId.split("__")[0]! : sourceId;
  const tgtBase = targetId.includes("__") ? targetId.split("__")[0]! : targetId;

  /* Same parent pipeline stage→stage = building-level local */
  if (
    sourceId.includes("__") &&
    targetId.includes("__") &&
    srcBase === tgtBase
  ) {
    return "local";
  }

  const sz = zoneOfNode(sourceId);
  const tz = zoneOfNode(targetId);
  if (sz && tz && sz !== tz) return "trunk";
  if (sz && tz && sz === tz) {
    /* Same city, different buildings — street-level branch unless both stages */
    if (sourceId.includes("__") || targetId.includes("__")) return "local";
    return "branch";
  }
  return "branch";
}

/** CRM mirror syncs / feedback loops — dashed data cables */
const DATA_CABLE_IDS = new Set([
  "e-katana-mfg-new",
  "e-procure-mfg-sync",
  "e-tube-mfg-purchasing",
  "e-pod-mfg-production",
  "e-inngest-mfg",
]);

const DATA_CABLE_RE = /sync|mirror|mfg-purchasing|mfg-production|mfg-new|reject/i;

export function isDataCable(
  edgeId: string,
  explicit?: boolean | null
): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  if (DATA_CABLE_IDS.has(edgeId)) return true;
  return DATA_CABLE_RE.test(edgeId);
}

/** Stable trunk lane 0–5 for parallel snake-tray offset */
export function trunkLaneIndex(edgeId: string): number {
  let h = 0;
  for (let i = 0; i < edgeId.length; i++) {
    h = (h * 31 + edgeId.charCodeAt(i)) >>> 0;
  }
  return h % 6;
}

/** Parallel tray gaps — wider for high-voltage trunks */
export const TRUNK_GAP_PX = 12;
export const TRUNK_BASE_OFFSET = 48;

export const LEVEL_BASE_OFFSET: Record<GridLevel, number> = {
  trunk: 96,
  branch: 52,
  local: 28,
};

export const LEVEL_GAP_PX: Record<GridLevel, number> = {
  trunk: 14,
  branch: 10,
  local: 8,
};
