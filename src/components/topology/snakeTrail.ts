"use client";

/**
 * Growing-snake circuit trail — shared visual constants for edge lifecycle.
 *
 * dormant   → Dark Grid slate, no motion
 * active    → Snake head (draw + particle crawl)
 * trail     → Solid body (cumulative, never dissolves during a run)
 * complete  → Entire trail pulses as a closed circuit
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const CIRCUIT_TRAIL_COLOR = "#22d3ee";
export const SNAKE_BODY_WIDTH = 5.5;
export const SNAKE_BODY_COMPLETE_WIDTH = 6.5;
export const SNAKE_BODY_OPACITY = 1;
export const SNAKE_HEAD_WIDTH = 5;
export const SNAKE_HEAD_PARTICLE_R = 6;
export const SNAKE_HEAD_DASH = "14 10";
export const CIRCUIT_PULSE_CLASS = "circuit-trail-pulse";
export const BASE_SPEED_PIXELS_PER_SEC = 400;
export const SNAKE_DURATION_MIN_S = 0.35;

export function snakeDurationSec(pathLength: number, fallbackMs: number): number {
  if (pathLength > 1) {
    return Math.max(SNAKE_DURATION_MIN_S, pathLength / BASE_SPEED_PIXELS_PER_SEC);
  }
  return Math.max(SNAKE_DURATION_MIN_S, fallbackMs / 1000);
}

export function circuitTrailPaint(
  journeyColor: string | undefined,
  circuitComplete: boolean
): {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  glow: string;
} {
  const stroke = journeyColor || CIRCUIT_TRAIL_COLOR;
  return {
    stroke,
    strokeWidth: circuitComplete ? SNAKE_BODY_COMPLETE_WIDTH : SNAKE_BODY_WIDTH,
    opacity: SNAKE_BODY_OPACITY,
    glow: stroke,
  };
}

/** Measure the live SVG path and convert length → constant-velocity duration. */
export function useSnakePathTiming(
  pathD: string,
  travelKey: number,
  fallbackMs: number
): {
  pathRef: RefObject<SVGPathElement | null>;
  pathLength: number;
  durationSec: number;
  animationDuration: string;
} {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  useLayoutEffect(() => {
    const node = pathRef.current;
    if (!node) return;
    try {
      const len = node.getTotalLength();
      if (Number.isFinite(len) && len > 0) setPathLength(len);
    } catch {
      /* Path not attached to the document yet */
    }
  }, [pathD, travelKey]);

  const durationSec = snakeDurationSec(pathLength, fallbackMs);
  return {
    pathRef,
    pathLength,
    durationSec,
    animationDuration: `${durationSec}s`,
  };
}
