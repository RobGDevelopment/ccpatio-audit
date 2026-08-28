"use client";

import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { motion } from "framer-motion";
import { useTopologyStore } from "./topologyStore";
import { JOURNEY_COLORS } from "./sequences";
import { nodeFocusOpacity } from "./viewConfig";
import { getStory } from "./stories";
import {
  formatStepDelta,
  lookupCalendar,
} from "./dwellCalendar";
import { RolePill } from "./RolePill";
import type { RoleAssignment } from "./roleConfig";
import { districtForNode } from "./zoneTheme";
import { ExecutionStateIndicator } from "../control/ExecutionStateIndicator";
import {
  roleBadgeClassName,
  type RoleBadge,
} from "./zoneCardLabels";
import { activePipelinesForWalkthrough } from "./ghlPipelines";

function RoleBadgeChip({ badge }: { badge: RoleBadge }) {
  return (
    <span
      className={`rounded px-1 py-px text-[7px] font-semibold uppercase tracking-[0.1em] ${roleBadgeClassName(badge)}`}
    >
      {badge}
    </span>
  );
}

const PORT_DOT =
  "!h-2.5 !w-2.5 !border-0 !bg-cyan-300 !shadow-[0_0_8px_rgba(34,211,238,0.85)]";

/**
 * Labeled beam plugs. Handle ids stay `left` (target) / `right` (source)
 * so Play / snake edges keep working. Cards: Top INPUT, Right OUTPUT.
 * Parent zones: both ports on the Top edge.
 */
function MapSelectFrame({ id }: { id: string }) {
  const selected = useTopologyStore((s) => s.selectedMapNodeId === id);
  if (!selected) return null;
  return (
    <div
      className="pointer-events-none absolute -inset-[3px] z-[29] rounded-md ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-950"
      aria-hidden
    />
  );
}

function IoPorts({
  inPosition = Position.Top,
  outPosition = Position.Right,
  inStyle,
  outStyle,
  zone = false,
  hideIn = false,
  hideOut = false,
  nodeId,
}: {
  inPosition?: Position;
  outPosition?: Position;
  inStyle?: CSSProperties;
  outStyle?: CSSProperties;
  zone?: boolean;
  hideIn?: boolean;
  hideOut?: boolean;
  nodeId?: string;
}) {
  const walkthroughId = useTopologyStore((s) => s.walkthroughId);
  const selectedMapNodeId = useTopologyStore((s) => s.selectedMapNodeId);
  const setPendingMapLink = useTopologyStore((s) => s.setPendingMapLink);
  const selectMapNode = useTopologyStore((s) => s.selectMapNode);
  const portsLive = Boolean(nodeId && walkthroughId && !zone);

  const startPort = (role: "input" | "output") => (e: ReactMouseEvent) => {
    if (!portsLive || !nodeId) return;
    e.stopPropagation();
    e.preventDefault();
    if (selectedMapNodeId !== nodeId) selectMapNode(nodeId);
    setPendingMapLink({ nodeId, role });
  };

  const inTop = inPosition === Position.Top;
  const outTop = outPosition === Position.Top;
  const label =
    "absolute z-[41] font-[family-name:var(--font-plex-mono)] font-bold uppercase tracking-[0.16em] text-cyan-200/90";
  return (
    <>
      {hideIn ? null : (
        <>
          <Handle
            type="target"
            position={inPosition}
            id="left"
            className={`${PORT_DOT} ${zone ? "pointer-events-auto !h-3.5 !w-3.5 !border-2 !border-cyan-100" : ""}`}
            style={{ zIndex: 40, ...inStyle }}
            title="input — drag here, or click the label to add a source"
          />
          <span
            role={portsLive ? "button" : undefined}
            title={portsLive ? "Click to add an input" : undefined}
            onClick={portsLive ? startPort("input") : undefined}
            className={`${label} ${
              portsLive ? "pointer-events-auto cursor-pointer hover:text-cyan-50" : "pointer-events-none"
            } ${
              zone
                ? "left-3 -top-3.5 text-[8px]"
                : inTop
                  ? "left-1/2 -top-3.5 -translate-x-1/2 text-[8px]"
                  : "left-1 top-1/2 -translate-y-1/2 text-[8px]"
            }`}
          >
            input
          </span>
        </>
      )}
      {hideOut ? null : (
        <>
          <Handle
            type="source"
            position={outPosition}
            id="right"
            className={`${PORT_DOT} ${zone ? "pointer-events-auto !h-3.5 !w-3.5 !border-2 !border-cyan-100" : ""}`}
            style={{ zIndex: 40, ...outStyle }}
            title="output — drag from here, or click the label to add a target"
          />
          <span
            role={portsLive ? "button" : undefined}
            title={portsLive ? "Click to add an output" : undefined}
            onClick={portsLive ? startPort("output") : undefined}
            className={`${label} ${
              portsLive ? "pointer-events-auto cursor-pointer hover:text-cyan-50" : "pointer-events-none"
            } ${
              zone || outTop
                ? "right-3 -top-3.5 text-[8px]"
                : "right-[-2px] top-1/2 -translate-y-1/2 text-[8px] [writing-mode:vertical-rl] rotate-180"
            }`}
          >
            output
          </span>
        </>
      )}
    </>
  );
}

function openNodeEditor(
  _id: string,
  _type: string,
  _data: Record<string, unknown>,
  layoutEditMode: boolean,
) {
  if (layoutEditMode) return;
  /* Mapping inspector is owned by React Flow onNodeClick. */
}

export type SystemNodeData = {
  label: string;
  subtitle?: string;
  icon?: string;
  accent: string;
  zone?: string;
  role?: RoleAssignment;
  operational?: boolean;
  nodeType?: "standard" | "gateway" | "milestone";
  panelSlot?: "breaker" | "socket" | "rail";
  duration?: string;
  techStack?: string[];
  cardKindLabel?: string;
  roleBadge?: "HUMAN" | "AUTO" | "GATEWAY" | "MILESTONE";
  /** When set (GHL chips), highlight when this task id is active in playback */
  linkedTaskId?: string;
  /** GHL pipeline id — dimmed when not active in lifecycle dropdown */
  ghlPipelineId?: string;
  /** Top/Bottom system rail card */
  railKind?: "ghl" | "software";
};

export type SystemNodeType = Node<SystemNodeData, "system">;

export type RailCardData = {
  label: string;
  accent: string;
  subtitle?: string;
  railKind: "ghl" | "software";
  cardKindLabel?: string;
  roleBadge?: "HUMAN" | "AUTO" | "GATEWAY" | "MILESTONE";
  linkedTaskId?: string;
  ghlPipelineId?: string;
};

export type RailCardNodeType = Node<RailCardData, "railCard">;

function RailCardNodeComponent({ id, data }: NodeProps<RailCardNodeType>) {
  const {
    isPrimary,
    isSecondary,
    isCompleting,
    isDone,
    color,
    focusOpacity,
  } = useNodeVisual(id, data.linkedTaskId);

  const lit = isPrimary || isSecondary || isCompleting;
  const isGhl = data.railKind === "ghl";

  return (
    <motion.div
      className="nodrag nopan relative box-border flex h-full min-h-[132px] w-full flex-col justify-center overflow-visible rounded-lg border px-3 py-2.5"
      animate={{
        opacity: focusOpacity,
        boxShadow: lit
          ? `0 0 22px ${color}aa, inset 0 0 18px ${color}33`
          : `0 0 14px ${data.accent}44, inset 0 0 10px ${data.accent}18`,
        borderColor: lit ? color : `${data.accent}99`,
      }}
      transition={{ duration: 0.45 }}
      style={{
        borderWidth: 2,
        background:
          lit
            ? `linear-gradient(165deg, ${color}22 0%, #020617 55%)`
            : `linear-gradient(165deg, ${data.accent}18 0%, #020617 60%)`,
        zIndex: 28,
      }}
      title={data.label}
    >
      <MapSelectFrame id={id} />
      <IoPorts nodeId={id} />
      <div className="absolute right-2 top-2 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div
        className={`mt-1.5 wrap-break-word whitespace-normal font-semibold leading-snug text-slate-50 ${
          isGhl ? "text-[15px]" : "text-[16px]"
        }`}
      >
        {isDone || isCompleting ? (
          <span className="mr-1.5 text-emerald-400">✓</span>
        ) : null}
        {data.label}
      </div>
      {data.subtitle ? (
        <div className="mt-1.5 whitespace-pre-wrap text-[12px] text-slate-400">
          {data.subtitle}
        </div>
      ) : null}
    </motion.div>
  );
}

export const RailCardNode = memo(RailCardNodeComponent);

function useNodeVisual(id: string, linkedTaskId?: string) {
  const activeNodeId = useTopologyStore((s) => s.activeNodeId);
  const secondaryNodeIds = useTopologyStore((s) => s.secondaryNodeIds);
  const latchedNodeIds = useTopologyStore((s) => s.latchedNodeIds);
  const fadingNodeId = useTopologyStore((s) => s.fadingNodeId);
  const completingNodeId = useTopologyStore((s) => s.completingNodeId);
  const completedNodeIds = useTopologyStore((s) => s.completedNodeIds);
  const traceRootId = useTopologyStore((s) => s.traceRootId);
  const traceNodeIds = useTopologyStore((s) => s.traceNodeIds);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const externalActive = useTopologyStore((s) => s.externalActive);
  const viewMode = useTopologyStore((s) => s.viewMode);
  const roleLens = useTopologyStore((s) => s.roleLens);
  const showPlumbing = useTopologyStore((s) => s.showPlumbing);
  const journeyColor = JOURNEY_COLORS[journeyId];
  const district = districtForNode(linkedTaskId ?? id);
  /** Hot glow uses journey; idle district accent grounds the city */
  const color = journeyColor;
  const districtAccent = district.accent;

  const matches = (nid: string | null | undefined) =>
    nid === id || (linkedTaskId != null && nid === linkedTaskId);

  const isPrimary = matches(activeNodeId) || matches(traceRootId);
  const isLatched =
    (latchedNodeIds.includes(id) ||
      (linkedTaskId != null && latchedNodeIds.includes(linkedTaskId))) &&
    !isPrimary;
  const isSecondary =
    secondaryNodeIds.includes(id) ||
    (linkedTaskId != null && secondaryNodeIds.includes(linkedTaskId)) ||
    traceNodeIds.includes(id) ||
    (linkedTaskId != null && traceNodeIds.includes(linkedTaskId)) ||
    isLatched;
  const isFading = matches(fadingNodeId);
  const isCompleting = matches(completingNodeId);
  const isDone =
    completedNodeIds.includes(id) ||
    (linkedTaskId != null && completedNodeIds.includes(linkedTaskId));
  const isHot = isPrimary || isSecondary || isCompleting || isFading;

  const focusOpacity = nodeFocusOpacity(
    linkedTaskId ?? id,
    viewMode,
    roleLens,
    showPlumbing,
    isHot || isDone,
    journeyId
  );

  return {
    isPrimary,
    isSecondary,
    isLatched,
    isFading,
    isCompleting,
    isDone,
    externalActive,
    color,
    districtAccent,
    focusOpacity,
  };
}

function SystemNodeComponent({ id, data }: NodeProps<SystemNodeType>) {
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const {
    isPrimary,
    isSecondary,
    isFading,
    isCompleting,
    isDone,
    externalActive,
    color,
    districtAccent,
    focusOpacity,
  } = useNodeVisual(id, data.linkedTaskId);

  const dragClass = layoutEditMode ? "" : "nodrag nopan";
  const isBreaker = Boolean(data.operational && data.panelSlot === "breaker");
  const walkthroughId = useTopologyStore((s) => s.walkthroughId);
  const ghlDimmed = Boolean(
    data.ghlPipelineId &&
      !activePipelinesForWalkthrough(walkthroughId).has(data.ghlPipelineId)
  );
  const dimOpacity = ghlDimmed ? Math.min(focusOpacity, 0.28) : focusOpacity;

  if (isBreaker) {
    return (
      <motion.div
        role="button"
        tabIndex={0}
        title={data.label}
        onClick={() => {
          openNodeEditor(id, "system", data as Record<string, unknown>, layoutEditMode);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openNodeEditor(id, "system", data as Record<string, unknown>, layoutEditMode);
          }
        }}
        animate={{
          opacity: dimOpacity,
          boxShadow: isCompleting
            ? `0 0 16px ${districtAccent}77`
            : isPrimary
              ? `inset 0 0 16px ${color}33, 0 0 18px ${color}99`
              : `inset 0 0 12px ${districtAccent}14`,
        }}
        className={`${dragClass} relative box-border h-full min-h-[132px] w-full cursor-pointer overflow-visible rounded-sm border bg-slate-950 text-slate-300`}
        style={{
          borderWidth: 1.5,
          borderColor: isPrimary ? color : `${districtAccent}77`,
          backgroundColor: "#020617",
          zIndex: 24,
        }}
      >
        <MapSelectFrame id={id} />
        <IoPorts nodeId={id} />
        <div className="absolute right-1.5 top-1.5 z-10">
          <ExecutionStateIndicator nodeId={id} />
        </div>
        <div className="flex h-full items-stretch">
          <div className="w-1.5 shrink-0" style={{ background: data.accent }} />
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="wrap-break-word whitespace-normal text-[13px] font-semibold leading-snug text-slate-100">
                {isDone || isCompleting ? (
                  <span className="mr-1 text-emerald-400">✓</span>
                ) : null}
                {data.label}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {data.roleBadge ? <RoleBadgeChip badge={data.roleBadge} /> : null}
              </div>
            </div>
            <div
              className="shrink-0 rounded-sm border px-1.5 py-1 text-center font-[family-name:var(--font-plex-mono)]"
              style={{ borderColor: `${data.accent}88`, color: data.accent }}
            >
              <div className="text-[12px] font-bold leading-none">
                {data.duration ?? data.subtitle ?? "—"}
              </div>
              <div className="mt-0.5 text-[7px] uppercase tracking-[0.16em] text-slate-500">
                dwell
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      title={
        layoutEditMode
          ? "Layout mode — drag to reposition"
          : "Click to open Integration Editor"
      }
      onClick={() => {
        openNodeEditor(id, "system", data as Record<string, unknown>, layoutEditMode);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "system", data as Record<string, unknown>, layoutEditMode);
        }
      }}
      animate={{
        opacity: focusOpacity,
        scale: isPrimary ? (externalActive ? 1.06 : 1.05) : isSecondary ? 1.02 : 1,
        borderColor: isCompleting
          ? districtAccent
          : isPrimary
            ? color
            : isSecondary
              ? `${color}99`
              : isFading
                ? `${color}44`
                : `${districtAccent}66`,
        boxShadow: isCompleting
          ? `0 0 20px ${districtAccent}77`
          : isPrimary
            ? `inset 0 0 24px ${color}33, 0 0 28px ${color}cc, 0 0 52px ${color}55`
            : isSecondary
              ? `0 0 14px ${color}66`
              : isFading
                ? `0 0 8px ${color}22`
                : `inset 0 0 18px ${districtAccent}18`,
      }}
      transition={{
        duration: isFading ? 1.15 : isCompleting ? 0.35 : isPrimary ? 0.9 : 0.65,
        ease: [0.22, 1, 0.36, 1],
        ...(isPrimary
          ? {
              boxShadow: {
                duration: 1.5,
                repeat: Infinity,
                repeatType: "mirror" as const,
              },
            }
          : {}),
      }}
      className={
        id === "ghl-hub"
          ? `${dragClass} relative min-w-[220px] cursor-pointer overflow-visible rounded-xl border bg-slate-950 px-3.5 py-3 text-slate-300 hover:border-slate-500`
          : `${dragClass} relative min-w-[200px] cursor-pointer overflow-visible rounded-xl border bg-slate-950 px-3.5 py-2.5 text-slate-300 hover:border-slate-500`
      }
      style={{
        borderWidth: 1.5,
        backgroundColor: "#020617",
        zIndex: 20,
        opacity: isDone ? 0.78 : undefined,
      }}
    >
      <MapSelectFrame id={id} />
      <IoPorts nodeId={id} />
      <div className="absolute right-2 top-2 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold"
          style={{
            background:
              isPrimary || isSecondary
                ? `${color}28`
                : `${districtAccent}22`,
            color:
              isPrimary || isSecondary ? color : districtAccent,
          }}
        >
          {data.icon ?? data.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          {data.operational && data.zone ? (
            <span
              className="mb-1 inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em]"
              style={{
                color: data.accent,
                background: `${data.accent}22`,
                border: `1px solid ${data.accent}66`,
              }}
            >
              {zoneShortBadge(data.zone)}
            </span>
          ) : (
            <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">
              {data.zone}
            </div>
          )}
          <div
            className={`wrap-break-word whitespace-normal text-[13px] font-semibold leading-snug ${
              isPrimary || isCompleting
                ? "text-white"
                : isDone
                  ? "text-slate-400"
                  : "text-slate-200"
            }`}
          >
            {isDone || isCompleting ? (
              <span className="mr-1.5 text-[11px] font-bold text-emerald-400">
                ✓
              </span>
            ) : null}
            {data.label}
          </div>
          {data.subtitle ? (
            <div className="mt-0.5 text-[10px] leading-snug text-slate-400">
              {data.subtitle}
            </div>
          ) : null}
          <div className="mt-1">
            <RolePill
              nodeId={id}
              zone={data.zone}
              role={data.role}
              accent={districtAccent}
            />
          </div>
          {isPrimary ? (
            <DwellChip
              nodeId={id}
              zone={data.zone}
              color={color}
            />
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function DwellChip({
  nodeId,
  stageId,
  zone,
  color,
}: {
  nodeId: string;
  stageId?: string | null;
  zone?: string;
  color: string;
}) {
  const journeyId = useTopologyStore((s) => s.journeyId);
  const activeStoryKey = useTopologyStore((s) => s.activeStoryKey);
  const stepTone = useTopologyStore((s) => s.stepTone);
  const story = getStory(nodeId, stageId, journeyId, activeStoryKey);
  if (!story) return null;
  const cal = lookupCalendar(nodeId, stageId, activeStoryKey);
  const calLabel = formatStepDelta(cal);
  const chipColor = stepTone === "exception" ? "#fb7185" : color;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {zone || story.zone ? (
        <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] text-slate-400">
          {zone ?? story.zone}
        </span>
      ) : null}
      <span
        className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em]"
        style={{ borderColor: `${chipColor}66`, color: chipColor }}
      >
        {story.dwell}
      </span>
      {calLabel ? (
        <span
          className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[8px] tabular-nums tracking-[0.08em] text-slate-400"
          title="Calendar-day estimate (dwellCalendar.ts)"
        >
          {calLabel}
        </span>
      ) : null}
    </div>
  );
}

export const SystemNode = memo(SystemNodeComponent);

export type SocketNodeType = Node<SystemNodeData, "socket">;

function SocketNodeComponent({ id, data }: NodeProps<SocketNodeType>) {
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const { isPrimary, isDone, isCompleting, focusOpacity } = useNodeVisual(
    id,
    data.linkedTaskId
  );
  const dragClass = layoutEditMode ? "" : "nodrag nopan";
  const accent = data.accent;

  return (
    <div
      role="button"
      tabIndex={0}
      title={data.label}
        onClick={() => {
          openNodeEditor(id, "socket", data as Record<string, unknown>, layoutEditMode);
        }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "socket", data as Record<string, unknown>, layoutEditMode);
        }
      }}
      className={`${dragClass} relative box-border flex h-full w-full cursor-pointer items-center justify-center`}
      style={{ opacity: focusOpacity, zIndex: 24 }}
    >
      <MapSelectFrame id={id} />
      <IoPorts nodeId={id} />
      <div className="absolute right-2 top-1 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div
        className="flex h-[84%] w-[92%] flex-col justify-center px-3 py-1.5 text-left"
        style={{
          background: "#020617",
          border: `1.5px solid ${accent}`,
          boxShadow: isPrimary
            ? `0 0 18px ${accent}99`
            : `0 0 10px ${accent}44`,
          clipPath:
            "polygon(12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px), 0 12px)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="text-[7px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: accent }}
          >
            {data.cardKindLabel ?? "Socket · Auto"}
          </div>
          <RoleBadgeChip badge={data.roleBadge ?? "AUTO"} />
        </div>
        <div className="mt-0.5 wrap-break-word whitespace-normal text-[12px] font-semibold leading-snug text-slate-100">
          {isDone || isCompleting ? (
            <span className="mr-1 text-emerald-400">✓</span>
          ) : null}
          {data.label}
        </div>
        <div className="mt-0.5 font-[family-name:var(--font-plex-mono)] text-[9px]" style={{ color: accent }}>
          {data.duration ?? data.subtitle ?? ""}
        </div>
      </div>
    </div>
  );
}

export const SocketNode = memo(SocketNodeComponent);

function zoneShortBadge(zone: string): string {
  const match = zone.match(/^Zone (\d+):\s*(.+)$/);
  if (!match) return zone;
  return `Z${match[1]} ${match[2]}`;
}

export type GatewayNodeType = Node<SystemNodeData, "gateway">;
export type MilestoneNodeType = Node<SystemNodeData, "milestone">;

function GatewayNodeComponent({ id, data }: NodeProps<GatewayNodeType>) {
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const { isPrimary, isSecondary, isDone, isCompleting, focusOpacity } =
    useNodeVisual(id, data.linkedTaskId);
  const accent = data.accent;
  const dragClass = layoutEditMode ? "" : "nodrag nopan";

  return (
    <div
      role="button"
      tabIndex={0}
      title="Click to inspect process mapping"
        onClick={() => {
          openNodeEditor(id, "gateway", data as Record<string, unknown>, layoutEditMode);
        }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "gateway", data as Record<string, unknown>, layoutEditMode);
        }
      }}
      className={`${dragClass} relative cursor-pointer`}
      style={{
        width: data.operational ? "100%" : 140,
        height: data.operational ? "100%" : 140,
        opacity: focusOpacity,
        zIndex: 24,
      }}
    >
      <MapSelectFrame id={id} />
      <IoPorts nodeId={id} />
      <div className="absolute right-1 top-1 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div
        className="pointer-events-none absolute"
        style={{
        inset: data.operational ? 8 : 22,
          transform: "rotate(45deg)",
          border: `2px solid ${accent}`,
          background:
            "linear-gradient(180deg, rgba(2,6,23,0.96) 0%, rgba(15,23,42,0.92) 100%)",
          boxShadow: isPrimary
            ? `0 0 22px ${accent}, 0 0 48px ${accent}66`
            : isSecondary
              ? `0 0 14px ${accent}99`
              : `0 0 16px ${accent}55, inset 0 0 18px ${accent}22`,
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span
            className="text-[8px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: accent }}
          >
            Gateway
          </span>
          <RoleBadgeChip badge={data.roleBadge ?? "GATEWAY"} />
        </div>
        <span className="mt-1 wrap-break-word whitespace-normal text-[12px] font-semibold leading-snug text-slate-100">
          {isDone || isCompleting ? (
            <span className="mr-1 text-emerald-400">✓</span>
          ) : null}
          {data.label}
        </span>
        {data.zone ? (
          <span className="mt-1 text-[8px] uppercase tracking-wider text-slate-500">
            {zoneShortBadge(data.zone)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MilestoneNodeComponent({ id, data }: NodeProps<MilestoneNodeType>) {
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const { isPrimary, isSecondary, isDone, isCompleting, focusOpacity } =
    useNodeVisual(id, data.linkedTaskId);
  const accent = data.accent;
  const dragClass = layoutEditMode ? "" : "nodrag nopan";

  return (
    <div
      role="button"
      tabIndex={0}
      title="Click to inspect process mapping"
        onClick={() => {
          openNodeEditor(id, "milestone", data as Record<string, unknown>, layoutEditMode);
        }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "milestone", data as Record<string, unknown>, layoutEditMode);
        }
      }}
      className={`${dragClass} relative box-border h-full cursor-pointer overflow-visible rounded-xl border-2 bg-slate-950 px-3 py-2`}
      style={{
        width: data.operational ? "100%" : 280,
        minHeight: data.operational ? undefined : 96,
        height: data.operational ? "100%" : undefined,
        opacity: focusOpacity,
        zIndex: 24,
        borderColor: accent,
        backgroundColor: "#020617",
        boxShadow: isPrimary
          ? `0 0 22px ${accent}, 0 0 48px ${accent}66`
          : isSecondary
            ? `0 0 16px ${accent}99`
            : `0 0 18px ${accent}77, 0 0 36px ${accent}33`,
      }}
    >
      <MapSelectFrame id={id} />
      <IoPorts nodeId={id} />
      <div className="absolute right-2 top-2 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
          style={{ background: `${accent}28`, color: accent }}
        >
          ★
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em]"
              style={{
                color: accent,
                background: `${accent}22`,
                border: `1px solid ${accent}66`,
              }}
            >
              Milestone
            </span>
            <RoleBadgeChip badge={data.roleBadge ?? "MILESTONE"} />
            {data.zone ? (
              <span className="text-[8px] uppercase tracking-wider text-slate-500">
                {zoneShortBadge(data.zone)}
              </span>
            ) : null}
          </div>
          <div className="mt-1 wrap-break-word whitespace-normal text-[13px] font-semibold leading-snug text-white">
            {isDone || isCompleting ? (
              <span className="mr-1.5 text-emerald-400">✓</span>
            ) : null}
            {data.label}
          </div>
          {data.subtitle ? (
            <div className="mt-0.5 text-[10px] text-slate-400">{data.subtitle}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const GatewayNode = memo(GatewayNodeComponent);
export const MilestoneNode = memo(MilestoneNodeComponent);

export type ZoneNodeData = {
  label: string;
  accent: string;
  panel?: boolean;
  humanColumn?: string;
  digitalColumn?: string;
  shortTitle?: string;
  hideEmptyColumn?: boolean;
  hasHumanColumn?: boolean;
  hasDigitalColumn?: boolean;
  railKind?: "systems" | "middleware" | "ghl";
};

export type ZoneNodeType = Node<ZoneNodeData, "zone">;

function ZoneNodeComponent({ id, data }: NodeProps<ZoneNodeType>) {
  const energizedZoneIds = useTopologyStore((s) => s.energizedZoneIds);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const color = JOURNEY_COLORS[journeyId];
  const live = energizedZoneIds.includes(id);
  const panel = data.panel === true;

  return (
    <div
      className={`pointer-events-none relative h-full w-full overflow-visible rounded-2xl border transition-[box-shadow,border-color] duration-500 ${
        panel ? "" : "px-12 py-16"
      }`}
      style={{
        borderColor: live ? `${color}88` : `${data.accent}66`,
        borderStyle: "solid",
        borderWidth: live ? 2 : 1.5,
        background: live
          ? `linear-gradient(180deg, ${color}18 0%, ${data.accent}08 32%, transparent 58%)`
          : `linear-gradient(180deg, ${data.accent}14 0%, ${data.accent}07 24%, rgba(2,6,23,0.55) 55%)`,
        boxShadow: live
          ? `inset 0 0 40px ${color}22, 0 0 24px ${color}33`
          : `inset 0 0 28px ${data.accent}10`,
      }}
    >
      <IoPorts
        zone
        inPosition={Position.Top}
        outPosition={Position.Top}
        inStyle={{ left: 18 }}
        outStyle={{ left: "calc(100% - 18px)" }}
      />
      {panel ? (
        <>
          <div
            className="absolute inset-x-16 top-3 text-center"
            style={{ color: live ? color : data.accent }}
          >
            <div className="px-1 text-[12px] font-bold uppercase leading-snug tracking-[0.12em] drop-shadow sm:text-[13px]">
              <span className="whitespace-normal">
                {data.shortTitle ?? data.label}
              </span>
              {live ? (
                <span className="ml-2 inline-block text-[9px] font-semibold tracking-[0.12em] opacity-80">
                  · ENERGIZED
                </span>
              ) : null}
            </div>
            {data.railKind ? (
              <div className="mt-1 font-[family-name:var(--font-plex-mono)] text-[8px] uppercase tracking-[0.22em] text-slate-500">
                {data.railKind === "middleware"
                  ? "Horizontal bus · input → output"
                  : data.railKind === "systems"
                    ? "Software sockets · Top in · Right out"
                    : "GHL pipelines · Top in · Right out"}
              </div>
            ) : (
              <div className="mt-1 flex justify-between gap-2 px-2 font-[family-name:var(--font-plex-mono)] text-[8px] uppercase leading-tight tracking-[0.14em] text-slate-500">
                {data.hideEmptyColumn && data.hasHumanColumn === false ? null : (
                  <span className="max-w-[48%] text-left">
                    {data.humanColumn ?? "Steps · Human"}
                  </span>
                )}
                {data.hideEmptyColumn && data.hasDigitalColumn === false ? null : (
                  <span className="max-w-[48%] text-right">
                    {data.digitalColumn ?? "input → output"}
                  </span>
                )}
              </div>
            )}
          </div>
          <div
            className={`pointer-events-none absolute left-8 right-8 rounded-lg border border-dashed ${
              data.railKind
                ? "top-[28px] h-[76px]"
                : "bottom-3 top-[124px]"
            }`}
            style={{ borderColor: live ? `${color}33` : `${data.accent}22` }}
            aria-hidden
          />
        </>
      ) : (
        <>
          <div
            className="pointer-events-none absolute inset-8 rounded-xl border border-dashed"
            style={{ borderColor: live ? `${color}44` : `${data.accent}22` }}
            aria-hidden
          />
          <div
            className="relative text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: live ? color : `${data.accent}cc` }}
          >
            {data.label}
            {live ? (
              <span className="ml-2 tracking-[0.12em] text-[9px] opacity-80">
                · ENERGIZED
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export const ZoneNode = memo(ZoneNodeComponent);

export type GridTieNodeData = {
  zoneId: string;
  label: string;
  accent: string;
  kind?: "in" | "out";
};

export type GridTieNodeType = Node<GridTieNodeData, "gridTie">;

function GridTieNodeComponent({ id, data }: NodeProps<GridTieNodeType>) {
  const energizedZoneIds = useTopologyStore((s) => s.energizedZoneIds);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const color = JOURNEY_COLORS[journeyId];
  const live = energizedZoneIds.includes(data.zoneId);
  const kind = data.kind;
  const tag = kind === "out" ? "OUT" : "IN";

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center rounded-sm border bg-slate-950 px-1"
      style={{
        borderColor: live ? color : `${data.accent}99`,
        backgroundColor: "#020617",
        boxShadow: live
          ? `0 0 14px ${color}99, inset 0 0 10px ${color}33`
          : `0 0 8px ${data.accent}33`,
        zIndex: 30,
      }}
    >
      <div
        className="mb-0.5 h-1 w-7 rounded-sm"
        style={{
          background: live ? color : `${data.accent}aa`,
          boxShadow: live ? `0 0 8px ${color}` : "none",
        }}
      />
      <div
        className="font-[family-name:var(--font-plex-mono)] text-[8px] font-bold uppercase tracking-[0.18em]"
        style={{ color: live ? color : "#e2e8f0" }}
      >
        {live ? "LIVE" : tag}
      </div>
      <IoPorts
        inPosition={Position.Top}
        outPosition={Position.Top}
        hideOut={kind === "in"}
        hideIn={kind === "out"}
      />
      <span className="sr-only">{id}</span>
    </div>
  );
}

export const GridTieNode = memo(GridTieNodeComponent);

export type PipelineStage = {
  id: string;
  label: string;
  dimmed?: boolean;
  role?: RoleAssignment;
};

export type PipelineNodeData = {
  title: string;
  subtitle?: string;
  accent: string;
  stages: PipelineStage[];
  /** Granular graph: header shell only — stages are child nodes */
  shellOnly?: boolean;
};

export type StageNodeData = {
  label: string;
  stageId: string;
  parentPipelineId: string;
  accent: string;
  dimmed?: boolean;
  index: number;
  role?: RoleAssignment;
};

export type StageNodeType = Node<StageNodeData, "stage">;

export type PipelineNodeType = Node<PipelineNodeData, "pipeline">;

function PipelineNodeComponent({ id, data }: NodeProps<PipelineNodeType>) {
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const activeStageId = useTopologyStore((s) => s.activeStageId);
  const fadingStageId = useTopologyStore((s) => s.fadingStageId);
  const completingStageId = useTopologyStore((s) => s.completingStageId);
  const completedStageIds = useTopologyStore((s) => s.completedStageIds);
  const externalActive = useTopologyStore((s) => s.externalActive);
  const {
    isPrimary,
    isSecondary,
    isFading,
    isCompleting,
    isDone,
    color,
    districtAccent,
    focusOpacity,
  } = useNodeVisual(id);

  const shellOnly = data.shellOnly === true;
  const dragClass = layoutEditMode && !shellOnly ? "" : layoutEditMode ? "" : "nodrag nopan";
  const parentHot =
    isPrimary ||
    isSecondary ||
    isCompleting ||
    (activeStageId != null &&
      data.stages.some((s) => s.id === activeStageId));

  return (
    <motion.div
      role="button"
      tabIndex={0}
      title={
        layoutEditMode
          ? "Layout mode — drag this parent box"
          : "Click to open Integration Editor"
      }
        onClick={() => {
          openNodeEditor(id, "pipeline", data as Record<string, unknown>, layoutEditMode);
        }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "pipeline", data as Record<string, unknown>, layoutEditMode);
        }
      }}
      animate={{
        opacity: focusOpacity,
        scale: parentHot && !shellOnly ? 1.02 : 1,
        borderColor: parentHot
          ? color
          : isDone
            ? "#166534"
            : `${districtAccent}66`,
        boxShadow: parentHot
          ? `0 0 16px ${color}55`
          : `inset 0 0 20px ${districtAccent}12`,
      }}
      transition={{ duration: isFading ? 1.1 : 0.65 }}
      className={`${dragClass} relative cursor-pointer rounded-xl border bg-slate-950 px-3 py-2.5 text-slate-300 hover:border-slate-500 ${
        shellOnly
          ? "h-full min-w-[244px] overflow-visible"
          : "min-w-[250px] max-w-[300px]"
      } ${shellOnly && !layoutEditMode ? "pointer-events-none" : ""} ${
        shellOnly && layoutEditMode ? "pointer-events-auto" : ""
      }`}
      style={{
        borderWidth: 1.5,
        backgroundColor: "#020617",
        zIndex: 15,
      }}
    >
      <IoPorts />
      <div className="absolute right-2 top-2 z-10">
        <ExecutionStateIndicator nodeId={id} />
      </div>
      <div className={shellOnly ? "" : "mb-2"}>
        <div
          className="pointer-events-auto text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: parentHot ? color : districtAccent }}
        >
          {data.title}
        </div>
        {data.subtitle ? (
          <div className="pointer-events-auto text-[10px] text-slate-400">
            {data.subtitle}
          </div>
        ) : null}
        {parentHot && !shellOnly ? (
          <DwellChip
            nodeId={id}
            stageId={activeStageId}
            zone={data.title}
            color={color}
          />
        ) : null}
      </div>
      {!shellOnly ? (
      <div className="flex flex-col gap-1">
        {data.stages.map((stage, idx) => {
          if (stage.dimmed) {
            return (
              <div
                key={stage.id}
                className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1"
              >
                <span className="font-[family-name:var(--font-plex-mono)] text-[9px] text-slate-600">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="text-[10px] font-medium text-slate-500 line-through">
                  {stage.label}
                </span>
                <span className="ml-auto text-[8px] uppercase text-slate-600">
                  hold
                </span>
              </div>
            );
          }

          const stageActive = activeStageId === stage.id;
          const stageCompleting = completingStageId === stage.id;
          const stageFading = fadingStageId === stage.id;
          const stageDone = completedStageIds.includes(stage.id);

          return (
            <motion.div
              key={stage.id}
              animate={{
                scale: stageActive ? 1.04 : 1,
                backgroundColor: stageCompleting
                  ? "rgba(74,222,128,0.25)"
                  : stageActive
                    ? `${color}35`
                    : stageDone
                      ? "rgba(22,101,52,0.25)"
                      : "#0f172a99",
                borderColor: stageCompleting
                  ? "#4ade80"
                  : stageActive
                    ? color
                    : stageDone
                      ? "#166534"
                      : "#33415588",
                boxShadow: stageActive
                  ? externalActive
                    ? `0 0 16px ${color}aa`
                    : `0 0 12px ${color}88`
                  : stageCompleting
                    ? "0 0 14px rgba(74,222,128,0.7)"
                    : "0 0 0px transparent",
                opacity: stageFading ? 0.55 : 1,
              }}
              transition={{
                duration: stageFading ? 1.15 : stageCompleting ? 0.35 : 0.5,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5"
            >
              <span className="font-[family-name:var(--font-plex-mono)] text-[9px] text-slate-500">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span
                className="text-[11px] font-medium"
                style={{
                  color: stageActive || stageCompleting ? "#f8fafc" : "#cbd5e1",
                }}
              >
                {stage.label}
              </span>
              {stageDone || stageCompleting ? (
                <span className="ml-auto text-[10px] font-bold text-emerald-400">
                  ✓
                </span>
              ) : stageActive ? (
                <span
                  className="ml-auto shrink-0 rounded px-1 text-[8px] uppercase tracking-[0.1em]"
                  style={{ color, border: `1px solid ${color}66` }}
                >
                  dwell
                </span>
              ) : null}
            </motion.div>
          );
        })}
      </div>
      ) : null}
    </motion.div>
  );
}

export const PipelineNode = memo(PipelineNodeComponent);

function StageNodeComponent({ id, data }: NodeProps<StageNodeType>) {
  const activeNodeId = useTopologyStore((s) => s.activeNodeId);
  const activeStageId = useTopologyStore((s) => s.activeStageId);
  const fadingStageId = useTopologyStore((s) => s.fadingStageId);
  const completingStageId = useTopologyStore((s) => s.completingStageId);
  const completedStageIds = useTopologyStore((s) => s.completedStageIds);
  const externalActive = useTopologyStore((s) => s.externalActive);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const viewMode = useTopologyStore((s) => s.viewMode);
  const roleLens = useTopologyStore((s) => s.roleLens);
  const showPlumbing = useTopologyStore((s) => s.showPlumbing);
  const traceNodeIds = useTopologyStore((s) => s.traceNodeIds);
  const traceRootId = useTopologyStore((s) => s.traceRootId);
  const latchedNodeIds = useTopologyStore((s) => s.latchedNodeIds);
  const latchedStageIds = useTopologyStore((s) => s.latchedStageIds);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const color = JOURNEY_COLORS[journeyId];

  const parentId = data.parentPipelineId;
  const isActive =
    activeNodeId === parentId && activeStageId === data.stageId;
  const isLatched =
    latchedStageIds.includes(data.stageId) ||
    (latchedNodeIds.includes(parentId) && !isActive);
  const isCompleting = completingStageId === data.stageId;
  const isFading = fadingStageId === data.stageId;
  const isDone = completedStageIds.includes(data.stageId);
  const isTraced =
    traceRootId === parentId ||
    traceRootId === id ||
    traceNodeIds.includes(id) ||
    traceNodeIds.includes(parentId);
  const isHot = isActive || isCompleting || isFading || isTraced || isLatched;
  const districtAccent = districtForNode(parentId).accent;

  const focusOpacity = nodeFocusOpacity(
    parentId,
    viewMode,
    roleLens,
    showPlumbing,
    isHot || isDone,
    journeyId
  );

  if (data.dimmed) {
    return (
      <div
        className="pointer-events-none flex h-full w-full items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2 py-1"
        style={{ opacity: focusOpacity, backgroundColor: "#020617", zIndex: 25 }}
      >
        <span className="font-[family-name:var(--font-plex-mono)] text-[9px] text-slate-600">
          {String(data.index + 1).padStart(2, "0")}
        </span>
        <span className="wrap-break-word whitespace-normal text-[11px] font-medium text-slate-500 line-through">
          {data.label}
        </span>
      </div>
    );
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      title="Click to inspect process mapping"
        onClick={() => {
          openNodeEditor(id, "stage", data as Record<string, unknown>, false);
        }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNodeEditor(id, "stage", data as Record<string, unknown>, false);
        }
      }}
      animate={{
        opacity: isDone ? Math.min(focusOpacity, 0.72) : focusOpacity,
        scale: isActive ? (externalActive ? 1.04 : 1.03) : 1,
        backgroundColor: isCompleting
          ? `${districtAccent}33`
          : isActive
            ? `${districtAccent}40`
            : isLatched
              ? `${districtAccent}18`
              : "#020617",
        borderColor: isCompleting
          ? districtAccent
          : isActive
            ? districtAccent
            : isLatched
              ? `${districtAccent}99`
              : `${districtAccent}66`,
        boxShadow: isActive
          ? `inset 0 0 14px ${districtAccent}44, 0 0 18px ${districtAccent}88`
          : isCompleting
            ? `0 0 12px ${districtAccent}66`
            : `inset 0 0 8px ${districtAccent}14`,
      }}
      transition={{
        duration: isFading ? 1.15 : isCompleting ? 0.35 : isActive ? 0.85 : 0.55,
        ease: [0.22, 1, 0.36, 1],
        ...(isActive
          ? {
              boxShadow: {
                duration: 1.5,
                repeat: Infinity,
                repeatType: "mirror" as const,
              },
            }
          : {}),
      }}
      className="nodrag nopan relative flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 overflow-visible rounded-md border bg-slate-950 px-2 py-1.5 box-border"
      style={{ zIndex: 25, backgroundColor: "#020617" }}
    >
      <IoPorts />
      <div className="absolute right-1 top-0.5 z-10">
        <ExecutionStateIndicator nodeId={id} size="sm" />
      </div>
      <div className="flex min-w-0 items-center gap-2">
      <span
        className="font-[family-name:var(--font-plex-mono)] text-[9px]"
        style={{ color: isDone ? `${districtAccent}88` : "#64748b" }}
      >
        {String(data.index + 1).padStart(2, "0")}
      </span>
      <span
        className="min-w-0 flex-1 wrap-break-word whitespace-normal text-[12px] font-medium leading-snug"
        style={{
          color: isActive || isCompleting
            ? "#f8fafc"
            : isDone
              ? "#94a3b8"
              : "#cbd5e1",
        }}
      >
        {data.label}
      </span>
      {isActive ? (
        <span
          className="shrink-0 rounded px-1 text-[8px] uppercase tracking-[0.1em]"
          style={{ color: districtAccent, border: `1px solid ${districtAccent}66` }}
        >
          dwell
        </span>
      ) : null}
      </div>
      <RolePill
        nodeId={parentId}
        stageId={data.stageId}
        role={data.role}
        compact
        accent={districtAccent}
      />
    </motion.div>
  );
}

export const StageNode = memo(StageNodeComponent);

export type BlankSlotData = {
  label: string;
  zone: string;
  zoneId: string;
  accent: string;
};

export type BlankSlotNodeType = Node<BlankSlotData, "blankSlot">;

function BlankSlotNodeComponent({ id, data }: NodeProps<BlankSlotNodeType>) {
  const canvasMode = useTopologyStore((s) => s.canvasMode);
  const plugBlankSlot = useTopologyStore((s) => s.plugBlankSlot);

  if (canvasMode === "present") {
    return (
      <div
        className="relative box-border flex h-full w-full items-center justify-center overflow-visible rounded-md border border-dashed border-slate-800/80 bg-slate-950/40"
        style={{ zIndex: 20 }}
      >
        <IoPorts />
      </div>
    );
  }

  return (
    <button
      type="button"
      title="Plug in a new process step"
      onClick={(e) => {
        e.stopPropagation();
        const title = window.prompt("New step title", "New process step");
        if (title === null) return;
        plugBlankSlot(data.zoneId, data.zone as import("../../schema/operationalTask").OperationalZone, title);
      }}
      className="nodrag nopan relative box-border flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-600 bg-slate-950/70 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-200"
      style={{ zIndex: 20, borderColor: `${data.accent}44` }}
    >
      <IoPorts />
      <span className="text-lg leading-none">+</span>
      <span className="text-[9px] uppercase tracking-[0.14em]">{data.label}</span>
      <span className="sr-only">{id}</span>
    </button>
  );
}

export const BlankSlotNode = memo(BlankSlotNodeComponent);
