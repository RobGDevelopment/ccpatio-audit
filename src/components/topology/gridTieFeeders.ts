/**
 * Grid Tie feeder edges — drop from the city plug down to energized buildings/tasks.
 */

import type { Edge } from "@xyflow/react";
import type { BeamEdgeData } from "./BeamEdge";
import { feederEdgeId, gridTieId } from "./zoneLayout";
import { zoneOfNode } from "./utilityTypes";
import { resolveStepFocusId } from "./granularGraph";

export function makeFeederEdge(
  zoneId: string,
  targetId: string
): Edge<BeamEdgeData> {
  return {
    id: feederEdgeId(zoneId, targetId),
    source: gridTieId(zoneId),
    target: targetId,
    sourceHandle: "right",
    targetHandle: "left",
    type: "beam",
    zIndex: 2,
    data: {
      gridLevel: "branch",
      utility: "digital",
      feeder: true,
      brief: true,
    },
  };
}

/** Nested task feeder: building shell → stage button */
export function makeTaskFeederEdge(
  parentId: string,
  stageId: string
): Edge<BeamEdgeData> {
  const target = resolveStepFocusId(parentId, stageId);
  return {
    id: `e-task-${parentId}-${stageId}`,
    source: parentId,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "beam",
    zIndex: 3,
    data: {
      gridLevel: "local",
      utility: "digital",
      feeder: true,
      brief: true,
    },
  };
}

export function collectCascadeFeeders(opts: {
  nodeId: string;
  stageId?: string;
  fanOutNodes?: string[];
}): {
  zoneIds: string[];
  nodeIds: string[];
  stageIds: string[];
  edges: Edge<BeamEdgeData>[];
  edgeIds: string[];
} {
  const nodeIds = [...new Set([opts.nodeId, ...(opts.fanOutNodes ?? [])])];
  const stageIds = opts.stageId ? [opts.stageId] : [];
  const zoneIds = [
    ...new Set(
      nodeIds.map((id) => zoneOfNode(id)).filter((z): z is string => !!z)
    ),
  ];

  const edges: Edge<BeamEdgeData>[] = [];
  for (const nid of nodeIds) {
    const z = zoneOfNode(nid);
    if (!z) continue;
    const focus =
      nid === opts.nodeId && opts.stageId
        ? resolveStepFocusId(nid, opts.stageId)
        : nid;
    edges.push(makeFeederEdge(z, focus));
    if (nid === opts.nodeId && opts.stageId) {
      /* Also light the parent building via a short task drop */
      edges.push(makeFeederEdge(z, nid));
      edges.push(makeTaskFeederEdge(nid, opts.stageId));
    }
  }

  const dedup = new Map(edges.map((e) => [e.id, e]));
  const unique = [...dedup.values()];
  return {
    zoneIds,
    nodeIds,
    stageIds,
    edges: unique,
    edgeIds: unique.map((e) => e.id),
  };
}
