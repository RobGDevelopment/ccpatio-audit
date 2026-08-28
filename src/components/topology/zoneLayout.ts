/**
 * Master-plan city layout — metadata only (auto-layout handled by dagre)
 */

import type { Node } from "@xyflow/react";
import type { ZoneNodeData } from "./nodes";

export type ZoneBandSpec = {
  id: string;
  label: string;
  accent: string;
};

export const ZONE_BANDS: ZoneBandSpec[] = [
  { id: "z0", label: "Zone 0 · Omnichannel Ingestion & Marketing", accent: "#818cf8" },
  { id: "z1", label: "Zone 1 · Pipeline Routing", accent: "#6366f1" },
  { id: "z2", label: "Zone 2 · CRM Pipelines", accent: "#a78bfa" },
  { id: "z3", label: "Zone 3 · Showroom Sales (Parallel)", accent: "#8b5cf6" },
  { id: "z4", label: "Zone 4 · Design · Deposit · Cut Lists", accent: "#c084fc" },
  { id: "z5", label: "Zone 5 · Middleware Core (V8)", accent: "#22d3ee" },
  { id: "z6", label: "Zone 6 · Factory Work Centers & QC", accent: "#fbbf24" },
  { id: "z7", label: "Zone 7 · Logistics Dispatch", accent: "#34d399" },
  { id: "z8", label: "Zone 8 · Treasury & Post-Care", accent: "#10b981" },
];

export const ZONE_H = 1780 + 130 * 2;

export const ZONE_LAYOUTS = ZONE_BANDS.map(z => ({
  ...z,
  x: 0,
  w: 0,
  y: 0,
  shiftX: 0,
  shiftedContentX: 0
}));

export function gridTieId(zoneId: string): string {
  return `gt-${zoneId}`;
}

export function zoneIdFromGridTie(id: string): string | null {
  return id.startsWith("gt-") ? id.slice(3) : null;
}

export function buildZoneNodes(): Node[] {
  return ZONE_BANDS.map((z) => ({
    id: z.id,
    type: "zone",
    position: { x: 0, y: 0 },
    data: { label: z.label, accent: z.accent } satisfies ZoneNodeData,
    style: { zIndex: -1 },
    selectable: false,
    draggable: false,
  }));
}

export type GridTieNodeData = {
  zoneId: string;
  label: string;
  accent: string;
};

export function buildGridTieNodes(): Node[] {
  return ZONE_BANDS.map((z) => ({
    id: gridTieId(z.id),
    type: "gridTie",
    position: { x: 0, y: 0 },
    data: {
      zoneId: z.id,
      label: "Grid Tie",
      accent: z.accent,
    } satisfies GridTieNodeData,
    style: {
      zIndex: 30,
      backgroundColor: "#020617",
    },
    selectable: false,
    draggable: false,
  }));
}

export function applyZoneCorridorShift(nodes: Node[]): Node[] {
  // Legacy function no longer applies shifts, layout handled by dagre
  return nodes;
}

export function feederEdgeId(zoneId: string, targetId: string): string {
  return `e-feed-${zoneId}-${targetId.replace(/__/g, "_")}`;
}

export function autosizeZoneShells(nodes: Node[]): Node[] {
  // Legacy function no longer resizes manually, handled by dagre/css
  return nodes;
}
