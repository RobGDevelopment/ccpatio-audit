/**
 * Audience modes + role lenses.
 * Engineer = full map always (growth surface for new ops detail).
 * Board / Ops never delete nodes — they only dim focus.
 */

import {
  collectSpineIds,
  getActiveSequence,
  type JourneyId,
} from "./sequences";
import { parseGranularNodeId } from "./granularGraph";

function spineMatches(spine: Set<string>, nodeId: string): boolean {
  if (spine.has(nodeId)) return true;
  const { nodeId: parent } = parseGranularNodeId(nodeId);
  return spine.has(parent);
}

function roleMatches(roleSet: Set<string>, nodeId: string): boolean {
  if (roleSet.size === 0) return true;
  if (roleSet.has(nodeId)) return true;
  const { nodeId: parent } = parseGranularNodeId(nodeId);
  return roleSet.has(parent);
}

export type ViewMode = "board" | "ops" | "engineer";
export type RoleLens =
  | "all"
  | "sales"
  | "design"
  | "factory"
  | "logistics"
  | "finance"
  | "service";

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  board: "Board Brief",
  ops: "Ops Tour",
  engineer: "Full Map (Everything)",
};

export const ROLE_LENS_LABELS: Record<RoleLens, string> = {
  all: "All departments",
  sales: "Sales",
  design: "Design / CAD",
  factory: "Factory / QC",
  logistics: "Logistics",
  finance: "Finance",
  service: "Service / Warranty",
};

/** Zones always visible in every mode (structure) */
export const ZONE_IDS = new Set([
  "z0",
  "z1",
  "z2",
  "z3",
  "z4",
  "z5",
  "z6",
  "z7",
  "z8",
]);

/** Role → node ids that stay emphasized in Ops Tour */
export const ROLE_NODE_IDS: Record<RoleLens, Set<string>> = {
  all: new Set(), // empty = treat as all
  sales: new Set([
    "traffic-meta",
    "traffic-google",
    "traffic-organic",
    "chan-phone",
    "chan-sms",
    "chan-whatsapp",
    "chan-webchat",
    "chan-email",
    "chan-social",
    "showroom-walkin",
    "ghl-hub",
    "leads-pipe",
    "trade-pipe",
    "sales-az",
    "sales-ca",
    "produce-az",
    "produce-ca",
  ]),
  design: new Set([
    "sales-az",
    "sales-ca",
    "field-survey",
    "sketchup",
    "cut-lists",
    "bom-packet",
  ]),
  factory: new Set([
    "katana",
    "inventory-alloc",
    "procurement-wait",
    "outsourced-accessories",
    "work-centers",
    "qc-gates",
    "mfg-pipe",
    "ingress",
    "inngest",
    "redis",
    "postgres",
    "produce-az",
    "produce-ca",
    "produce-warranty",
  ]),
  logistics: new Set(["dispatch-routes", "delivery", "mfg-pipe"]),
  finance: new Set([
    "delivery",
    "qbo",
    "clover",
    "reconciled",
    "sales-az",
    "sales-ca",
    "qbo-deposit-link",
    "clover-showroom",
    "payment-gateway",
  ]),
  service: new Set([
    "chan-whatsapp",
    "ghl-hub",
    "warranty-pipe",
    "produce-warranty",
    "work-centers",
    "qc-gates",
    "postcare",
    "mfg-pipe",
  ]),
};

/** Board Brief spine emphasis (still keeps full map in DOM) */
export const   BOARD_SPINE_IDS = new Set([
  "traffic-meta",
  "ghl-hub",
  "leads-pipe",
  "sales-az",
  "sketchup",
  "cut-lists",
  "bom-packet",
  "payment-gateway",
  "produce-az",
  "ingress",
  "katana",
  "inventory-alloc",
  "work-centers",
  "delivery",
  "qbo",
  "clover",
  "reconciled",
  "postcare",
]);

/** Plumbing — dimmed in Board unless “Show plumbing” is on — unless the spine itself is plumbing (Redis fail-open). */
export const PLUMBING_IDS = new Set(["redis", "postgres", "inngest"]);

export function isNodeEmphasized(
  nodeId: string,
  viewMode: ViewMode,
  roleLens: RoleLens,
  showPlumbing: boolean,
  journeyId: JourneyId
): boolean {
  if (ZONE_IDS.has(nodeId)) return true;
  if (nodeId.startsWith("gt-")) return true;
  if (viewMode === "engineer") return true;
  if (viewMode === "board") {
    const spine = collectSpineIds(getActiveSequence(journeyId, "board"));
    if (PLUMBING_IDS.has(nodeId) && !showPlumbing && !spine.has(nodeId)) {
      return false;
    }
    return spineMatches(spine, nodeId);
  }
  if (roleLens === "all") return true;
  return roleMatches(ROLE_NODE_IDS[roleLens], nodeId);
}

/** Soft dim — never hide; map stays extensible */
export function nodeFocusOpacity(
  nodeId: string,
  viewMode: ViewMode,
  roleLens: RoleLens,
  showPlumbing: boolean,
  isHot: boolean,
  journeyId: JourneyId
): number {
  if (isHot) return 1;
  if (viewMode === "engineer") return 1;
  if (isNodeEmphasized(nodeId, viewMode, roleLens, showPlumbing, journeyId))
    return 1;
  return viewMode === "board" ? 0.38 : 0.45;
}
