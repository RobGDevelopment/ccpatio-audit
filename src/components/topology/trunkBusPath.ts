/**
 * Dark Grid pathing — delegates to the global PCB router.
 * Right-out → gutter / top door / snake tray → Top-in. Never through card text.
 */

import { Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getSmartBeamPath } from "./edgeRouting";

export const OVERHEAD_CLEARANCE_Y = 300;

/** Legacy constant — no longer used for human snake hops */
export const MASTER_BUS_Y = -150;

export function getTrunkBusPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceId: string,
  targetId: string,
  nodes?: Node[]
): [path: string, labelX: number, labelY: number, busY: number] {
  const [path, labelX, labelY] = getSmartBeamPath(
    {
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition: Position.Right,
      targetPosition: Position.Top,
    },
    `trunk-${sourceId}-${targetId}`,
    sourceId,
    targetId,
    nodes ?? [],
    "trunk"
  );
  return [path, labelX, labelY, labelY];
}

export function getReturnTrunkPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceId: string,
  targetId: string,
  nodes?: Node[]
): [path: string, labelX: number, labelY: number, busY: number] {
  return getTrunkBusPath(
    targetX,
    targetY,
    sourceX,
    sourceY,
    targetId,
    sourceId,
    nodes
  );
}

/** True when the animated head should crawl right-to-left (or reverse dash). */
export function isRtlTravel(sourceX: number, targetX: number): boolean {
  return targetX < sourceX;
}
