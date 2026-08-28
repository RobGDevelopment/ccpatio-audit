/**
 * Scenario playback edge visibility + dual-color routing (cyan human flow / red automation).
 */

import type { Edge, Node } from "@xyflow/react";
import {
  isGhlRailTarget,
  isSoftwareStackTarget,
} from "./topology-scenarios";

export const SCENARIO_CYAN = "#06b6d4";
export const SCENARIO_RED = "#ef4444";

type PanelSlot = "breaker" | "railCard" | "socket";

function panelSlot(nodeId: string, graphNodes: Node[]): PanelSlot | null {
  const node = graphNodes.find((n) => n.id === nodeId);
  const slot = (node?.data as { panelSlot?: string } | undefined)?.panelSlot;
  if (slot === "breaker" || slot === "railCard" || slot === "socket") {
    return slot;
  }
  return null;
}

function canonicalNodeId(nodeId: string): string {
  const idx = nodeId.indexOf("__");
  return idx === -1 ? nodeId : nodeId.slice(idx + 2);
}

/** Middle-tier card → GHL top rail or software bottom stack. */
export function isAutomationBurstEdge(
  source: string,
  target: string,
  graphNodes: Node[],
): boolean {
  if (source.startsWith("ping-") || target.startsWith("ping-")) return true;

  const sourceSlot = panelSlot(source, graphNodes);
  const targetSlot = panelSlot(target, graphNodes);
  if (sourceSlot && targetSlot) {
    const isMiddle = (slot: PanelSlot) => slot === "breaker";
    const isRail = (slot: PanelSlot) => slot === "railCard";
    const isSoft = (slot: PanelSlot) => slot === "socket";
    return (
      (isMiddle(sourceSlot) && (isRail(targetSlot) || isSoft(targetSlot))) ||
      (isMiddle(targetSlot) && (isRail(sourceSlot) || isSoft(sourceSlot)))
    );
  }

  const sourceCanon = canonicalNodeId(source);
  const targetCanon = canonicalNodeId(target);
  const sourceAuto =
    isGhlRailTarget(source) ||
    isGhlRailTarget(sourceCanon) ||
    isSoftwareStackTarget(sourceCanon);
  const targetAuto =
    isGhlRailTarget(target) ||
    isGhlRailTarget(targetCanon) ||
    isSoftwareStackTarget(targetCanon);
  if (sourceAuto && !targetAuto) return true;
  if (targetAuto && !sourceAuto) return true;
  return false;
}

export function scenarioEdgeStroke(
  edgeId: string,
  source: string,
  target: string,
  graphNodes: Node[],
  opts?: { satellite?: boolean; mapKind?: string },
): string {
  if (
    opts?.satellite ||
    opts?.mapKind === "satellite" ||
    edgeId.startsWith("ping-")
  ) {
    return SCENARIO_RED;
  }
  if (isAutomationBurstEdge(source, target, graphNodes)) {
    return SCENARIO_RED;
  }
  return SCENARIO_CYAN;
}

export function collectScenarioVisibleEdgeIds(state: {
  travelEdgeIds: string[];
  trailEdgeIds: string[];
  feederEdgeIds: string[];
  retractingEdgeIds: string[];
  pendingFeederEdges: Edge[];
}): Set<string> {
  return new Set([
    ...state.travelEdgeIds,
    ...state.trailEdgeIds,
    ...state.feederEdgeIds,
    ...state.retractingEdgeIds,
    ...state.pendingFeederEdges.map((e) => e.id),
  ]);
}

export function isScenarioEdgeLit(
  edgeId: string,
  state: {
    travelEdgeIds: string[];
    trailEdgeIds: string[];
    feederEdgeIds: string[];
    retractingEdgeIds: string[];
    pendingFeederEdges: Edge[];
  },
): boolean {
  return collectScenarioVisibleEdgeIds(state).has(edgeId);
}

/** Force dormant edges completely invisible at the React Flow layer. */
export function muteEdgesForCanvas(
  edges: Edge[],
  visibleIds: Set<string>,
): Edge[] {
  return edges.map((edge) => {
    if (visibleIds.has(edge.id)) {
      return {
        ...edge,
        hidden: false,
        animated: false,
      };
    }
    return {
      ...edge,
      hidden: true,
      animated: false,
      style: {
        ...(edge.style ?? {}),
        opacity: 0,
        strokeOpacity: 0,
      },
    };
  });
}
