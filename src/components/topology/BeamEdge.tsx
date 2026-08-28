"use client";

/**
 * BeamEdge — global PCB routing (Right-out → top door / tray → Top-in).
 * Cyan workflow trail + optional red satellite circuit with dashoffset retract.
 */

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { motion } from "framer-motion";
import { useTopologyStore } from "./topologyStore";
import { type JourneyId, JOURNEY_COLORS } from "./sequences";
import { getSmartBeamPath } from "./edgeRouting";
import {
  isDataCable,
  zoneOfNode,
  type GridLevel,
  type UtilityKind,
} from "./utilityTypes";
import { DORMANT_WIDTH, ignitionForTarget } from "./zoneTheme";
import {
  CIRCUIT_PULSE_CLASS,
  SNAKE_HEAD_DASH,
  SNAKE_HEAD_PARTICLE_R,
  SNAKE_HEAD_WIDTH,
  circuitTrailPaint,
  useSnakePathTiming,
} from "./snakeTrail";
import {
  SCENARIO_CYAN,
  SCENARIO_RED,
  isScenarioEdgeLit,
  scenarioEdgeStroke,
} from "./scenarioEdgePolicy";

export type BeamEdgeData = {
  label?: string;
  brief?: boolean;
  lane?: JourneyId;
  utility?: UtilityKind;
  gridLevel?: GridLevel;
  cable?: boolean;
  feeder?: boolean;
  drop?: boolean;
  mutedBus?: boolean;
  interZone?: boolean;
  /** User-map kind: lifecycle next, GHL/software ping, or branch */
  mapKind?: "lifecycle" | "satellite" | "branch";
  /** Red circuit trigger — same L/R PCB path as cyan */
  satellite?: boolean;
  /** Reverse stroke-dashoffset (shrink from target back into source) */
  retracting?: boolean;
  railHop?: "down" | "up" | "across" | "software";
};

export type BeamEdgeType = Edge<BeamEdgeData, "beam">;

function BeamEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<BeamEdgeType>) {
  const graphNodes = useTopologyStore((s) => s.graphNodes);
  const travelEdgeIds = useTopologyStore((s) => s.travelEdgeIds);
  const trailEdgeIds = useTopologyStore((s) => s.trailEdgeIds);
  const circuitComplete = useTopologyStore((s) => s.circuitComplete);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const travelKey = useTopologyStore((s) => s.travelKey);
  const activeTravelMs = useTopologyStore((s) => s.activeTravelMs);
  const externalActive = useTopologyStore((s) => s.externalActive);
  const returnActive = useTopologyStore((s) => s.returnActive);
  const retractingIds = useTopologyStore((s) => s.retractingEdgeIds);
  const feederEdgeIds = useTopologyStore((s) => s.feederEdgeIds);
  const pendingFeederEdges = useTopologyStore((s) => s.pendingFeederEdges);
  const canvasEdgesMuted = useTopologyStore((s) => s.canvasEdgesMuted);
  const leadScenarioId = useTopologyStore((s) => s.leadScenarioId);
  const selectedMapNodeId = useTopologyStore((s) => s.selectedMapNodeId);

  const scenarioLit = isScenarioEdgeLit(id, {
    travelEdgeIds,
    trailEdgeIds,
    feederEdgeIds,
    retractingEdgeIds: retractingIds,
    pendingFeederEdges,
  });
  const isHidden = canvasEdgesMuted && !scenarioLit;

  const satellite = Boolean(data?.satellite);
  const cable = isDataCable(id, data?.cable);
  const ignite = ignitionForTarget(target);
  const sz = zoneOfNode(source);
  const tz = zoneOfNode(target);
  void (data?.interZone ?? !(sz && tz && sz === tz));

  const isCompleted = !satellite && trailEdgeIds.includes(id);
  const isActive = travelEdgeIds.includes(id);
  const isRetracting =
    retractingIds.includes(id) || Boolean(data?.retracting);
  const isReturn = returnActive && isActive && !satellite && !isRetracting;

  const [edgePath, labelX, labelY] = getSmartBeamPath(
    {
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition: sourcePosition ?? Position.Right,
      targetPosition: targetPosition ?? Position.Top,
    },
    id,
    source,
    target,
    graphNodes,
    data?.gridLevel ?? "branch"
  );
  const bodyPath = edgePath;

  const { pathRef, pathLength, durationSec: travelSec, animationDuration } =
    useSnakePathTiming(edgePath, travelKey, activeTravelMs);
  const easeCrawl: [number, number, number, number] = [0.16, 1, 0.3, 1];
  const dashLen = pathLength > 1 ? pathLength : 1;
  const headIgnite = satellite
    ? { stroke: "#f87171", glow: "#ef4444" }
    : isReturn
      ? ignitionForTarget(source)
      : ignite;

  let baseStroke = SCENARIO_CYAN;
  let baseWidth = DORMANT_WIDTH;
  let baseOpacity = 0;
  let baseGlow: string | undefined = undefined;
  let baseDash: string | undefined = cable ? "8 6" : undefined;

  if (isHidden) {
    baseOpacity = 0;
    baseGlow = undefined;
  } else if (scenarioLit) {
    baseOpacity = satellite ? 0.92 : isCompleted ? 0.88 : 0.95;
    baseWidth = satellite ? 2.6 : isActive || isCompleted ? 2.4 : 2;
    const stroke = scenarioEdgeStroke(id, source, target, graphNodes, {
      satellite,
      mapKind: data?.mapKind,
    });
    baseStroke = stroke;
    baseGlow =
      stroke === SCENARIO_RED
        ? "rgba(239,68,68,0.55)"
        : "rgba(6,182,212,0.55)";
    baseDash = undefined;
  } else if (satellite) {
    baseStroke = SCENARIO_RED;
    baseWidth = 2;
    baseOpacity = isActive || isRetracting ? 0.55 : 0.42;
    baseDash = undefined;
    baseGlow = "rgba(239,68,68,0.35)";
  } else if (isCompleted) {
    const paint = circuitTrailPaint(JOURNEY_COLORS[journeyId], circuitComplete);
    baseStroke = paint.stroke;
    baseWidth = paint.strokeWidth;
    baseOpacity = paint.opacity;
    baseGlow = paint.glow;
    baseDash = undefined;
  } else if (isActive) {
    baseOpacity = 0.35;
    baseDash = undefined;
  }

  if (selectedMapNodeId && !leadScenarioId) {
    const mapped =
      source === selectedMapNodeId || target === selectedMapNodeId;
    if (mapped) {
      baseOpacity = Math.max(baseOpacity, satellite ? 0.95 : 0.9);
      baseWidth = Math.max(baseWidth, satellite ? 2.6 : 2.2);
    } else {
      baseOpacity = Math.min(baseOpacity, 0.08);
    }
  }

  const headW = externalActive ? SNAKE_HEAD_WIDTH - 0.5 : SNAKE_HEAD_WIDTH;
  const particleR = externalActive
    ? SNAKE_HEAD_PARTICLE_R - 1.5
    : SNAKE_HEAD_PARTICLE_R;
  const showHead = !isHidden && (isActive || isRetracting);

  return (
    <g
      aria-hidden={isHidden}
      style={
        isHidden
          ? { opacity: 0, visibility: "hidden", pointerEvents: "none" }
          : undefined
      }
    >
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="none"
        pointerEvents="none"
        aria-hidden
      />
      <g className={circuitComplete && isCompleted ? CIRCUIT_PULSE_CLASS : undefined}>
        <BaseEdge
          id={`${id}-base`}
          path={bodyPath}
          style={{
            stroke: baseStroke,
            strokeWidth: baseWidth,
            opacity: baseOpacity,
            strokeLinecap: isCompleted ? "round" : "square",
            strokeLinejoin: isCompleted ? "round" : "miter",
            strokeDasharray: baseDash,
            filter: baseGlow
              ? `drop-shadow(0 0 ${circuitComplete ? 16 : 10}px ${baseGlow})`
              : undefined,
          }}
        />
      </g>

      {showHead ? (
        <g key={`snake-head-${travelKey}-${id}`}>
          {satellite ? (
            <motion.path
              d={edgePath}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.6}
              strokeLinecap="square"
              strokeLinejoin="miter"
              initial={
                isRetracting
                  ? { pathLength: 1, strokeDashoffset: 0 }
                  : { pathLength: 0, strokeDashoffset: dashLen }
              }
              animate={
                isRetracting
                  ? {
                      pathLength: 0,
                      strokeDashoffset: dashLen,
                    }
                  : {
                      pathLength: 1,
                      strokeDashoffset: 0,
                    }
              }
              transition={{ duration: travelSec, ease: easeCrawl }}
              style={{
                filter: "drop-shadow(0 0 8px #ef4444aa)",
                animationDuration,
              }}
            />
          ) : (
            <>
              <motion.path
                d={edgePath}
                fill="none"
                stroke={headIgnite.stroke}
                strokeWidth={headW}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={SNAKE_HEAD_DASH}
                initial={{
                  pathLength: isRetracting ? 1 : 0,
                  opacity: 1,
                }}
                animate={{
                  pathLength: isRetracting ? 0 : 1,
                  opacity: isReturn ? [1, 1, 0] : 1,
                }}
                transition={{ duration: travelSec, ease: easeCrawl }}
                style={{
                  filter: `drop-shadow(0 0 14px ${headIgnite.glow})`,
                  animationDuration,
                }}
              />
              <motion.circle
                r={particleR}
                fill="#ffffff"
                initial={{
                  offsetDistance: isRetracting ? "100%" : "0%",
                  opacity: 1,
                }}
                animate={{
                  offsetDistance: isRetracting ? "0%" : "100%",
                  opacity: isReturn ? [1, 1, 0] : 1,
                }}
                transition={{ duration: travelSec, ease: easeCrawl }}
                style={{
                  offsetPath: `path('${edgePath}')`,
                  offsetRotate: "0deg",
                  filter: `drop-shadow(0 0 12px ${headIgnite.stroke})`,
                  animationDuration,
                }}
              />
            </>
          )}
        </g>
      ) : satellite && !isRetracting && feederEdgeIds.includes(id) ? (
        <path
          d={edgePath}
          fill="none"
          stroke="#f87171"
          strokeWidth={2.4}
          strokeLinecap="square"
          strokeLinejoin="miter"
          style={{ filter: "drop-shadow(0 0 6px #ef444488)" }}
        />
      ) : null}

      {!isHidden && data?.label && (isActive || isCompleted || isRetracting) ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: headIgnite.stroke,
              zIndex: 1000,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}

export const BeamEdge = memo(BeamEdgeComponent);

export function BeamDefs() {
  return <svg width={0} height={0} className="absolute" aria-hidden />;
}
