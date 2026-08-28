"use client";

/**
 * TrunkBusEdge — overhead bus + intra-panel wires; trail stays solid (growing snake).
 */

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { motion } from "framer-motion";
import { useTopologyStore } from "./topologyStore";
import { JOURNEY_COLORS } from "./sequences";
import {
  getReturnTrunkPath,
  getTrunkBusPath,
  isRtlTravel,
} from "./trunkBusPath";
import { DORMANT_STROKE, DORMANT_WIDTH, ignitionForTarget } from "./zoneTheme";
import { isDataCable, zoneOfNode } from "./utilityTypes";
import type { BeamEdgeData } from "./BeamEdge";
import {
  SCENARIO_CYAN,
  SCENARIO_RED,
  isScenarioEdgeLit,
  scenarioEdgeStroke,
} from "./scenarioEdgePolicy";
import {
  CIRCUIT_PULSE_CLASS,
  SNAKE_HEAD_DASH,
  SNAKE_HEAD_PARTICLE_R,
  SNAKE_HEAD_WIDTH,
  circuitTrailPaint,
  useSnakePathTiming,
} from "./snakeTrail";

export type TrunkBusEdgeData = BeamEdgeData;
export type TrunkBusEdgeType = Edge<TrunkBusEdgeData, "trunkBus">;

function TrunkBusEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<TrunkBusEdgeType>) {
  const graphNodes = useTopologyStore((s) => s.graphNodes);
  const travelEdgeIds = useTopologyStore((s) => s.travelEdgeIds);
  const trailEdgeIds = useTopologyStore((s) => s.trailEdgeIds);
  const circuitComplete = useTopologyStore((s) => s.circuitComplete);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const travelKey = useTopologyStore((s) => s.travelKey);
  const activeTravelMs = useTopologyStore((s) => s.activeTravelMs);
  const externalActive = useTopologyStore((s) => s.externalActive);
  const returnActive = useTopologyStore((s) => s.returnActive);
  const retractingEdgeIds = useTopologyStore((s) => s.retractingEdgeIds);
  const feederEdgeIds = useTopologyStore((s) => s.feederEdgeIds);
  const pendingFeederEdges = useTopologyStore((s) => s.pendingFeederEdges);
  const canvasEdgesMuted = useTopologyStore((s) => s.canvasEdgesMuted);

  const isCompleted = trailEdgeIds.includes(id);
  const isActive = travelEdgeIds.includes(id);
  const isReturn = returnActive && isActive;

  const scenarioLit = isScenarioEdgeLit(id, {
    travelEdgeIds,
    trailEdgeIds,
    feederEdgeIds,
    retractingEdgeIds,
    pendingFeederEdges,
  });
  const isHidden = canvasEdgesMuted && !scenarioLit;

  const cable = isDataCable(id, data?.cable);
  const ignite = ignitionForTarget(target);
  const sz = zoneOfNode(source);
  const tz = zoneOfNode(target);
  void (data?.interZone ?? !(sz && tz && sz === tz));

  const [fwdPath, labelX, labelY] = getTrunkBusPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    source,
    target,
    graphNodes
  );
  const [retPath] = getReturnTrunkPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    source,
    target,
    graphNodes
  );
  const edgePath = isReturn ? retPath : fwdPath;
  const bodyPath = isCompleted ? fwdPath : edgePath;

  const { pathRef, durationSec: travelSec, animationDuration } = useSnakePathTiming(
    edgePath,
    travelKey,
    activeTravelMs
  );
  const easeCrawl: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
  const headIgnite = isReturn ? ignitionForTarget(source) : ignite;

  /* RTL / return: reverse dash crawl */
  const rtl =
    isReturn ||
    isRtlTravel(
      isReturn ? targetX : sourceX,
      isReturn ? sourceX : targetX
    );
  const dashFrom = rtl ? -48 : 0;
  const dashTo = rtl ? 48 : -48;

  let stroke = SCENARIO_CYAN;
  let width = DORMANT_WIDTH;
  let opacity = 0;
  let glow: string | undefined = undefined;
  let dash: string | undefined = cable ? "10 7" : undefined;

  if (isHidden) {
    opacity = 0;
    glow = undefined;
  } else if (scenarioLit) {
    opacity = isCompleted ? 0.88 : 0.95;
    width = isActive || isCompleted ? 2.4 : 2;
    stroke = scenarioEdgeStroke(id, source, target, graphNodes, {
      satellite: data?.satellite,
      mapKind: data?.mapKind,
    });
    glow =
      stroke === SCENARIO_RED
        ? "rgba(239,68,68,0.55)"
        : "rgba(6,182,212,0.55)";
    dash = undefined;
  } else if (isCompleted) {
    const paint = circuitTrailPaint(JOURNEY_COLORS[journeyId], circuitComplete);
    stroke = paint.stroke;
    width = paint.strokeWidth;
    opacity = paint.opacity;
    glow = paint.glow;
    dash = undefined;
  } else if (isActive) {
    stroke = DORMANT_STROKE;
    width = DORMANT_WIDTH;
    opacity = 0.35;
    glow = undefined;
    dash = undefined;
  }

  const headW = externalActive ? SNAKE_HEAD_WIDTH - 0.5 : SNAKE_HEAD_WIDTH + 0.4;
  const particleR = externalActive
    ? SNAKE_HEAD_PARTICLE_R - 1
    : SNAKE_HEAD_PARTICLE_R + 0.5;

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
          id={`${id}-bus`}
          path={bodyPath}
          style={{
            stroke,
            strokeWidth: width,
            opacity,
            strokeLinecap: isCompleted ? "round" : "square",
            strokeLinejoin: isCompleted ? "round" : "miter",
            strokeDasharray: dash,
            filter: glow
              ? `drop-shadow(0 0 ${circuitComplete ? 18 : 12}px ${glow})`
              : undefined,
          }}
        />
      </g>

      { !isHidden && isActive ? (
        <g key={`snake-head-${travelKey}-${id}`}>
          <motion.path
            d={edgePath}
            fill="none"
            stroke={headIgnite.stroke}
            strokeWidth={headW}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={SNAKE_HEAD_DASH}
            initial={{
              pathLength: 0,
              opacity: 1,
              strokeDashoffset: dashFrom,
            }}
            animate={{
              pathLength: 1,
              opacity: isReturn ? [1, 1, 0] : 1,
              strokeDashoffset: dashTo,
            }}
            transition={{ duration: travelSec, ease: easeCrawl }}
            style={{
              filter: `drop-shadow(0 0 16px ${headIgnite.glow})`,
              animationDuration,
            }}
          />
          <motion.circle
            r={particleR}
            fill="#ffffff"
            initial={{
              offsetDistance: rtl && !isReturn ? "100%" : "0%",
              opacity: 1,
            }}
            animate={{
              offsetDistance: rtl && !isReturn ? "0%" : "100%",
              opacity: isReturn ? [1, 1, 0] : 1,
            }}
            transition={{ duration: travelSec, ease: easeCrawl }}
            style={{
              offsetPath: `path('${edgePath}')`,
              offsetRotate: "0deg",
              filter: `drop-shadow(0 0 14px ${headIgnite.stroke})`,
              animationDuration,
            }}
          />
        </g>
      ) : null}

      {!isHidden && data?.label && (isActive || isCompleted) ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border border-slate-800 bg-slate-950/95 px-1.5 py-0.5 font-[family-name:var(--font-plex-mono)] text-[9px] uppercase tracking-[0.14em]"
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

export const TrunkBusEdge = memo(TrunkBusEdgeComponent);
