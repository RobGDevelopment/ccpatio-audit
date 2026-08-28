"use client";

/**
 * Red circuit wire — PCB Right-out → top door / tray → Top-in (same geometry as cyan).
 * Draw / retract via stroke-dashoffset on BeamEdge (satellite mode).
 */

import { memo } from "react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { BeamEdge, type BeamEdgeType } from "./BeamEdge";

export type PingEdgeData = {
  satellite?: boolean;
};

export type PingEdgeType = Edge<PingEdgeData, "ping">;

function PingEdgeComponent(props: EdgeProps<PingEdgeType>) {
  const beamProps = {
    ...props,
    data: { ...props.data, satellite: true as const },
  } as EdgeProps<BeamEdgeType>;
  return <BeamEdge {...beamProps} />;
}

export const PingEdge = memo(PingEdgeComponent);
