/**
 * Project MasterWorkflowSchema → React Flow nodes/edges.
 */

import type { Edge, Node } from "@xyflow/react";
import type { BeamEdgeData } from "../components/topology/BeamEdge";
import type { MasterWorkflowSchema, WorkflowNode } from "./schemaTypes";

function toRfNode(n: WorkflowNode): Node {
  const base: Node = {
    id: n.id,
    type: n.rfType ?? n.kind,
    position: { ...n.position },
    data: (n.dataExtra as Record<string, unknown>) ?? { label: n.label },
  };

  if (n.parentId) base.parentId = n.parentId;
  if (n.extent === "parent") base.extent = "parent";
  if (n.selectable != null) base.selectable = n.selectable;
  if (n.draggable != null) base.draggable = n.draggable;
  if (n.style) base.style = { ...n.style } as Node["style"];
  if (n.width != null) base.width = n.width;
  if (n.height != null) base.height = n.height;

  /* Ensure opaque buildings */
  if (n.kind === "system" || n.kind === "pipeline" || n.kind === "stage") {
    base.style = {
      ...(base.style ?? {}),
      backgroundColor: "#020617",
      zIndex: n.zIndex ?? (n.kind === "stage" ? 25 : n.kind === "pipeline" ? 15 : 20),
    };
  }
  if (n.kind === "zone") {
    base.style = {
      ...(base.style ?? {}),
      width: n.width ?? undefined,
      height: n.height ?? undefined,
      zIndex: -1,
    };
    base.selectable = false;
    base.draggable = false;
  }
  if (n.kind === "gridTie") {
    base.style = {
      ...(base.style ?? {}),
      width: n.width ?? 120,
      height: n.height ?? 44,
      zIndex: 30,
      backgroundColor: "#020617",
    };
    base.selectable = false;
    base.draggable = false;
  }

  return base;
}

export function compileTopology(schema: MasterWorkflowSchema): {
  nodes: Node[];
  edges: Edge<BeamEdgeData>[];
} {
  const nodes = schema.nodes.map(toRfNode);
  const edges: Edge<BeamEdgeData>[] = schema.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    type: "beam",
    hidden: e.hidden,
    zIndex: e.zIndex ?? 0,
    data: {
      label: e.label ?? undefined,
      brief: e.brief,
      lane: e.lane as BeamEdgeData["lane"],
      utility: e.utility ?? undefined,
      gridLevel: e.gridLevel ?? undefined,
      cable: e.cable,
    },
  }));
  return { nodes, edges };
}
