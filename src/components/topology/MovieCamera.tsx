"use client";

/**
 * Playback camera — pans React Flow viewport to keep the active human card
 * (and later ping targets) centered. No overflow:scroll on rails.
 */

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useTopologyStore } from "./topologyStore";

export function MovieCamera() {
  const rf = useReactFlow();
  const cameraFocusNodeId = useTopologyStore((s) => s.cameraFocusNodeId);
  const playbackState = useTopologyStore((s) => s.playbackState);
  const activeNodeId = useTopologyStore((s) => s.activeNodeId);

  const focusId =
    playbackState === "playing" || playbackState === "paused"
      ? (cameraFocusNodeId ?? activeNodeId)
      : cameraFocusNodeId;

  useEffect(() => {
    if (!focusId) return;
    if (playbackState === "idle" && !cameraFocusNodeId) return;

    const node = rf.getNode(focusId);
    if (!node) return;

    const w =
      typeof node.width === "number"
        ? node.width
        : typeof node.measured?.width === "number"
          ? node.measured.width
          : 180;
    const h =
      typeof node.height === "number"
        ? node.height
        : typeof node.measured?.height === "number"
          ? node.measured.height
          : 80;

    /* Absolute position for parented nodes */
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    while (parentId) {
      const parent = rf.getNode(parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }

    const cx = x + w / 2;
    const cy = y + h / 2;
    void rf.setCenter(cx, cy, { zoom: 0.85, duration: 550 });
  }, [focusId, cameraFocusNodeId, playbackState, rf]);

  return null;
}

/** Focus origin at movie start */
export function focusMovieOrigin(
  rf: { setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void; getNode: (id: string) => { position: { x: number; y: number }; parentId?: string; width?: number; height?: number; measured?: { width?: number; height?: number } } | undefined },
  originNodeId: string
) {
  const node = rf.getNode(originNodeId);
  if (!node) return;
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = rf.getNode(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  const w = node.width ?? node.measured?.width ?? 180;
  const h = node.height ?? node.measured?.height ?? 80;
  void rf.setCenter(x + w / 2, y + h / 2, { zoom: 0.85, duration: 400 });
}
