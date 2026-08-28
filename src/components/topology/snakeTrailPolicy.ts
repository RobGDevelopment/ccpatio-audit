/**
 * Edge classification helpers (inter-zone vs intra-zone).
 * Playback no longer dissolves locals — the growing snake keeps every traversed edge.
 */

import type { Edge } from "@xyflow/react";
import { zoneOfNode } from "./utilityTypes";

function edgeData(edge: Edge | undefined): {
  feeder?: boolean;
  drop?: boolean;
  mutedBus?: boolean;
} {
  return (edge?.data ?? {}) as {
    feeder?: boolean;
    drop?: boolean;
    mutedBus?: boolean;
  };
}

export function isInterZoneEdge(
  edgeId: string,
  edges: Edge[] | undefined | null
): boolean {
  const e = edges?.find((x) => x.id === edgeId);
  if (!e) return false;
  const data = edgeData(e);
  if (data.feeder) return false;
  if (data.mutedBus) return true;
  const sz = zoneOfNode(String(e.source));
  const tz = zoneOfNode(String(e.target));
  if (!sz || !tz) return true;
  return sz !== tz;
}

export function isIntraZoneEdge(
  edgeId: string,
  edges: Edge[] | undefined | null
): boolean {
  const e = edges?.find((x) => x.id === edgeId);
  if (!e) return false;
  const sz = zoneOfNode(String(e.source));
  const tz = zoneOfNode(String(e.target));
  return !!sz && !!tz && sz === tz;
}

export function isDissolveSyncCable(edgeId: string): boolean {
  return /sync|mirror|mfg-new|reject|procure-mfg/i.test(edgeId);
}

/** Permanent E2E snake body = inter-zone trunk only */
export function shouldPersistInSnake(
  edgeId: string,
  edges: Edge[] | undefined | null
): boolean {
  if (isDissolveSyncCable(edgeId)) return false;
  return isInterZoneEdge(edgeId, edges);
}

export function filterBackboneEdges(
  edgeIds: string[],
  edges: Edge[] | undefined | null
): string[] {
  return edgeIds.filter((id) => shouldPersistInSnake(id, edges));
}

/** Intra-zone / sync — dissolve after use */
export function filterLocalEdges(
  edgeIds: string[],
  edges: Edge[] | undefined | null
): string[] {
  return edgeIds.filter((id) => !shouldPersistInSnake(id, edges));
}

export function filterReturnEdges(
  edgeIds: string[],
  edges: Edge[] | undefined | null
): string[] {
  return filterLocalEdges(edgeIds, edges).filter((id) => {
    const e = edges?.find((x) => x.id === id);
    return !edgeData(e).drop;
  });
}
