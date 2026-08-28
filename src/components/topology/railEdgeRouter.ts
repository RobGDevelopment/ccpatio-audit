/**
 * Helpers for vertical rail-hop edges (human ↔ middleware / systems).
 */

import type { Edge } from "@xyflow/react";
import type { BeamEdgeData } from "./BeamEdge";

export type RailHop = "down" | "up" | "across" | "software";

export function isRailHopEdge(edge: Edge): boolean {
  const data = edge.data as BeamEdgeData | undefined;
  return Boolean(data && "railHop" in data && data.railHop);
}

export function railHopOf(edge: Edge): RailHop | null {
  const data = edge.data as (BeamEdgeData & { railHop?: RailHop }) | undefined;
  return data?.railHop ?? null;
}
