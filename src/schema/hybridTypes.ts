/** Shared row geometry + type for hybrid Touchpoint List ↔ Flow Canvas */

export const HYBRID_ROW_H = 44;
export const HYBRID_HEADER_H = 48;

export type HybridRow = {
  id: string;
  name: string;
  wbsCode: string;
  role: string;
  touchClass: "Human" | "System" | "Milestone" | "Zone";
  nodeId: string;
  stageId: string;
  parentTaskId: string | null;
  type: "project" | "task" | "milestone";
  progress: number;
  depth: number;
  zoneId: string;
  zoneColor: string;
  dependencies: string[];
};
