/**
 * Granular stage child nodes — beams dock on inner buttons, not parent shells.
 * ID convention: `{pipelineId}__{stageId}` (e.g. sales-az__az-produce)
 */

import type { Edge, Node } from "@xyflow/react";
import type { PipelineNodeData } from "./nodes";
import { lookupRole } from "./roleConfig";
import {
  classifyGridLevel,
  classifyUtility,
  isDataCable,
  zoneOfNode,
} from "./utilityTypes";
import type { BeamEdgeData } from "./BeamEdge";
import { autosizeZoneShells } from "./zoneLayout";

export const STAGE_SEP = "__";

export function granularNodeId(parentId: string, stageId?: string | null): string {
  if (!stageId) return parentId;
  return `${parentId}${STAGE_SEP}${stageId}`;
}

export function parseGranularNodeId(id: string): {
  nodeId: string;
  stageId?: string;
} {
  const idx = id.indexOf(STAGE_SEP);
  if (idx === -1) return { nodeId: id };
  return {
    nodeId: id.slice(0, idx),
    stageId: id.slice(idx + STAGE_SEP.length),
  };
}

export function resolveStepFocusId(
  nodeId: string,
  stageId?: string | null
): string {
  return granularNodeId(nodeId, stageId);
}

const STAGE_W = 228;
/** Fits label row + RolePill without vertical crush (factory has 12 stages) */
const STAGE_H = 56;
const STAGE_GAP = 6;
const HEADER_H = 56;
const SHELL_PAD_BOTTOM = 16;

/** Exact shell height for a pipeline with N stages — keep in sync with layout */
export function pipelineShellHeight(stageCount: number): number {
  return HEADER_H + stageCount * (STAGE_H + STAGE_GAP) + SHELL_PAD_BOTTOM;
}

/** Per-edge granular source/target overrides for beam docking */
export const GRANULAR_EDGE_OVERRIDES: Record<
  string,
  Partial<Pick<Edge, "source" | "target" | "sourceHandle" | "targetHandle">>
> = {
  "e-hub-leads": { target: "leads-pipe__lead-new" },
  "e-walkin-leads": { target: "leads-pipe__lead-new" },
  "e-leads-az": {
    source: "leads-pipe__lead-website",
    target: "sales-az__az-onsite",
  },
  "e-leads-new-az": {
    source: "leads-pipe__lead-new",
    target: "sales-az__az-onsite",
  },
  "e-hub-trade": { target: "trade-pipe__trade-app" },
  "e-trade-ca": {
    source: "trade-pipe__trade-approved",
    target: "sales-ca__ca-onsite",
  },
  "e-hub-warranty": { target: "warranty-pipe__warranty-discovery" },
  "e-az-survey": { source: "sales-az__az-sketchup-needed" },
  "e-ca-survey": { source: "sales-ca__ca-sketchup-needed" },
  "e-bom-az": { target: "sales-az__az-sketchup-done" },
  "e-bom-ca": { target: "sales-ca__ca-sketchup-done" },
  "e-az-produce-deposit-qbo": { source: "sales-az__az-produce" },
  "e-az-produce-deposit-clover": { source: "sales-az__az-produce" },
  "e-ca-produce-deposit-qbo": { source: "sales-ca__ca-produce" },
  "e-ca-produce-deposit-clover": { source: "sales-ca__ca-produce" },
  "e-gateway-approval-az": { target: "sales-az__az-approval" },
  "e-gateway-approval-ca": { target: "sales-ca__ca-approval" },
  "e-az-produce": { source: "sales-az__az-approval" },
  "e-ca-produce": { source: "sales-ca__ca-approval" },
  "e-warranty-produce": { source: "warranty-pipe__warranty-produce" },
  "e-alloc-chop": { target: "work-centers__wc-chop-saw" },
  "e-procure-stock": { target: "work-centers__wc-tube-stock" },
  "e-outsourced-marriage": { target: "work-centers__wc-marriage" },
  "e-pod-mfg-production": { target: "mfg-pipe__mfg-production" },
  "e-katana-mfg-new": { target: "mfg-pipe__mfg-new" },
  "e-procure-mfg-sync": { target: "mfg-pipe__mfg-purchasing" },
  "e-tube-mfg-purchasing": {
    source: "work-centers__wc-tube-stock",
    target: "mfg-pipe__mfg-purchasing",
  },
  "e-wc-qc": {
    source: "work-centers__wc-marriage",
    target: "qc-gates__qc-a",
  },
  "e-qc-mfg": {
    source: "qc-gates__qc-c",
    target: "mfg-pipe__mfg-ready",
  },
  "e-wc-flow": {
    source: "work-centers__wc-marriage",
    target: "qc-gates__qc-a",
  },
  "e-mfg-dispatch-box": { source: "mfg-pipe__mfg-ready", target: "dispatch-routes__dispatch-box" },
  "e-mfg-dispatch-3pl": { source: "mfg-pipe__mfg-ready", target: "dispatch-routes__dispatch-3pl" },
  "e-mfg-dispatch-willcall": { source: "mfg-pipe__mfg-ready", target: "dispatch-routes__dispatch-willcall" },
  "e-dispatch-box-delivery": { source: "dispatch-routes__dispatch-box" },
  "e-dispatch-3pl-delivery": { source: "dispatch-routes__dispatch-3pl" },
  "e-dispatch-willcall-delivery": { source: "dispatch-routes__dispatch-willcall" },
  "e-delivery-postcare": { source: "warranty-pipe__warranty-closed" },
};

function createStageChildren(pipeline: Node): Node[] {
  if (pipeline.type !== "pipeline") return [];
  const data = pipeline.data as PipelineNodeData;
  const stages = data.stages ?? [];
  const children: Node[] = [];
  let row = 0;
  for (const stage of stages) {
    const y = HEADER_H + row * (STAGE_H + STAGE_GAP);
    children.push({
      id: granularNodeId(pipeline.id!, stage.id),
      type: "stage",
      parentId: pipeline.id,
      extent: "parent",
      draggable: false,
      selectable: true,
      position: { x: 8, y },
      data: {
        label: stage.label,
        stageId: stage.id,
        parentPipelineId: pipeline.id,
        accent: data.accent,
        dimmed: stage.dimmed ?? false,
        index: row,
        role:
          stage.role ?? lookupRole(pipeline.id!, stage.id) ?? undefined,
      },
      style: { width: STAGE_W, height: STAGE_H, zIndex: 25 },
    });
    row += 1;
  }
  return children;
}

export function buildGranularGraph(
  baseNodes: Node[],
  baseEdges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  const pipelineIds = new Set(
    baseNodes.filter((n) => n.type === "pipeline").map((n) => n.id!)
  );

  const shells: Node[] = baseNodes.map((n) => {
    if (n.type !== "pipeline") {
      if (n.type === "system" || n.type === "gridTie") {
        return { ...n, draggable: n.type === "system" };
      }
      return n;
    }
    const data = n.data as PipelineNodeData;
    const stageCount = data.stages?.length ?? 0;
    const shellH = pipelineShellHeight(stageCount);
    return {
      ...n,
      draggable: true,
      data: { ...data, shellOnly: true },
      style: {
        ...(n.style ?? {}),
        width: 244,
        height: shellH,
        minHeight: shellH,
        zIndex: 15,
        backgroundColor: "#020617",
      },
    };
  });

  const stageChildren = baseNodes.flatMap((n) =>
    n.type === "pipeline" ? createStageChildren(n) : []
  );

  const edges = baseEdges.map((e) => {
    const ov = GRANULAR_EDGE_OVERRIDES[e.id];
    const source = ov?.source ?? e.source;
    let target = ov?.target ?? e.target;
    if (!ov?.target && pipelineIds.has(target)) {
      const pipe = baseNodes.find((n) => n.id === target);
      if (pipe?.type === "pipeline") {
        const stages = (pipe.data as PipelineNodeData).stages;
        const first = stages?.find((s) => !s.dimmed) ?? stages?.[0];
        if (first) target = granularNodeId(target, first.id);
      }
    }
    const prev = e.data as BeamEdgeData | undefined;
    const utility = prev?.utility ?? classifyUtility(e.id);
    const gridLevel =
      prev?.gridLevel ?? classifyGridLevel(e.id, source, target);
    const cable = prev?.cable ?? isDataCable(e.id);
    const sz = zoneOfNode(source);
    const tz = zoneOfNode(target);
    const inter = !(sz && tz && sz === tz);
    return {
      ...e,
      source,
      target,
      /* Inter-zone: Right→Left via trunk. Intra-zone: Bottom→Top vertical. */
      sourceHandle: "right",
      targetHandle: "left",
      zIndex: inter ? 2 : 0,
      data: {
        ...prev,
        utility,
        gridLevel,
        cable,
        interZone: inter,
      } satisfies BeamEdgeData,
    };
  });

  return {
    nodes: autosizeZoneShells([...shells, ...stageChildren]),
    edges,
  };
}
