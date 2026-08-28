import type { SequenceStep } from "./sequences";
import { LIFECYCLE_NODES } from "./lifecycleTopologyData";

/**
 * Executive presentation sequence — Node 1 → 12 in strict order.
 * travelEdges light the static beam path; particles grow edge-by-edge.
 */
export const LIFECYCLE_EXEC_SEQUENCE: SequenceStep[] = LIFECYCLE_NODES.map(
  (node, index) => {
    const prev = index > 0 ? LIFECYCLE_NODES[index - 1]! : null;
    const step: SequenceStep = {
      nodeId: node.id,
      dwellMs: index === 0 ? 3200 : index === LIFECYCLE_NODES.length - 1 ? 3600 : 2800,
      storyKey: node.id,
    };
    if (prev) {
      step.travelEdges = [
        `e-lc-${prev.id.replace("lc-", "")}-${node.id.replace("lc-", "")}`,
      ];
    }
    if (node.zoneId === "z-digital" && node.id === "lc-pim") {
      step.fanOutNodes = ["lc-sales-order"];
    }
    if (node.id === "lc-mo") {
      step.fanOutNodes = ["lc-aluminum"];
    }
    return step;
  },
);

export function isLifecycleNodeId(nodeId: string): boolean {
  return nodeId.startsWith("lc-");
}
