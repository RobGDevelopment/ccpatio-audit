/**
 * Command Sandwich layout — PCB Top-door protocol:
 *   Top:    GHL stages with breathing-room chips
 *   Middle: Human zones; beams enter/exit parent boxes from the TOP
 *   Bottom: Software / AUTO sockets
 * Cards: Top INPUT / Right OUTPUT. Parent zones: Top INPUT + Top OUTPUT.
 */

import type { Edge, Node } from "@xyflow/react";
import {
  OPERATIONAL_ZONES,
  OPERATIONAL_ZONE_ACCENT,
  coerceOperationalNodeType,
  parseDurationDays,
  type OperationalTask,
  type OperationalZone,
} from "../../schema/operationalTask";
import type { LayoutDirection } from "./layoutEngine";
import type { BeamEdgeData } from "./BeamEdge";
import type { SequenceStep } from "./sequences";
import { RETAIL_AZ_SPINE_ORDER, operationalZoneKey } from "./retailAzSpine";
import {
  classifyUtility,
  registerOperationalNodeZones,
} from "./utilityTypes";
import { labelsForZone, roleBadgeForNode } from "./zoneCardLabels";
import {
  gridTieInId,
  gridTieOutId,
  isDigitalSocket,
} from "./operationalTownGrid";
import {
  ghlChipId,
  snakeOrderForWalkthrough,
  SATELLITE_TARGETS,
  railStagesForWalkthrough,
  middleVisibleIdsForWalkthrough,
  type WalkthroughId,
} from "./ghlPipelines";
import { processLinksToEdges, seedProcessLinks, type ProcessLink } from "./processMap";
import { DWELL_MIN_MS } from "./sequences";

/** Middle human zones — Z1 (hub on bottom rail) and Z5 (middleware) excluded */
const HUMAN_ZONES: OperationalZone[] = OPERATIONAL_ZONES.filter(
  (z) =>
    z !== "Zone 1: CRM / Inbound Triage" &&
    z !== "Zone 5: Middleware Core"
);

const SOFTWARE_RAIL_IDS = [
  "ghl-hub",
  "sketchup",
  "katana",
  "qbo",
  "clover",
  "payment-gateway",
  "qbo-deposit-link",
  "clover-showroom",
] as const;

const MIDDLEWARE_IDS = [
  "ingress",
  "redis",
  "postgres",
  "inngest",
] as const;

const SOFTWARE_FALLBACK: { id: string; title: string; accent: string }[] = [
  { id: "ghl-hub", title: "GoHighLevel", accent: "#818cf8" },
  { id: "sketchup", title: "SketchUp", accent: "#c084fc" },
  { id: "sys-woo", title: "WooCommerce", accent: "#7dd3fc" },
  { id: "katana", title: "Katana MRP", accent: "#fbbf24" },
  { id: "qbo", title: "QuickBooks", accent: "#34d399" },
  { id: "clover", title: "Clover POS", accent: "#2dd4bf" },
  { id: "payment-gateway", title: "Payment Gateway", accent: "#2dd4bf" },
];

/**
 * Middle-band PCB bank: every parent zone is the same size, every human
 * card is the same size. 2-column fill, left plug-in gutter, right output tray.
 */
export const BANK_COLS = 2;
export const CARD_W = 280;
export const CARD_H = 160;
/** Top/Bottom system cards — narrower chips so rails have breathing room */
const RAIL_CARD_W = 156;
const RAIL_CARD_H = 140;
const RAIL_CARD_GAP = 44;
const RAIL_PAD_X = 28;
/** Internal header lane inside GHL / software rails (red pings travel here) */
export const RAIL_LANE_H = 112;
const RAIL_FOOTER_H = 48;
/** Vertical air between stacked cards so top plugs stay clear */
const CARD_V_GAP = 72;
const ROW_PITCH = CARD_H + CARD_V_GAP;
/** Intra-zone column tray (card Right → next column Top) */
export const COL_GAP = 96;
/** Incoming beams drop in this tray then plug into card Top */
export const PLUG_GUTTER_L = 88;
/** Card Right → zone doorway / snake tray to the next bank */
export const WIRE_GUTTER_R = 112;
/** Header room for Top INPUT / Top OUTPUT + internal bus */
export const ZONE_HEADER_H = 124;
const ZONE_FOOTER = 80;
const UNIFORM_ZONE_W =
  PLUG_GUTTER_L +
  BANK_COLS * CARD_W +
  (BANK_COLS - 1) * COL_GAP +
  WIRE_GUTTER_R;
/** Minimum inter-zone snake tray (zone OUT → next zone IN) */
const SNAKE_TRAY_MIN = 280;
const SOFTWARE_RAIL_H = RAIL_LANE_H + RAIL_CARD_H + RAIL_FOOTER_H;
const GHL_RAIL_EMPTY_H = RAIL_LANE_H + 72;
const GHL_RAIL_H = RAIL_LANE_H + RAIL_CARD_H + RAIL_FOOTER_H;
const BAND_GAP = 96;
const CANVAS_PAD = 28;
const BLANK_SLOT_ID_PREFIX = "blank-slot-";
const DWELL_MAX_MS = 9000;
const DAY_TO_DWELL_MS = 1600;

const LR = { sourceHandle: "right" as const, targetHandle: "left" as const };

function zoneIndexOf(zone: OperationalZone): number {
  const index = OPERATIONAL_ZONES.indexOf(zone);
  return index >= 0 ? index : 0;
}

function cardSize(_task: OperationalTask): { width: number; height: number } {
  void _task;
  return { width: CARD_W, height: CARD_H };
}

/** Fixed-width rail chips with leftover inner width turned into side + inter-chip gaps. */
function railChipLayout(
  inner: number,
  n: number
): { cardW: number; gap: number; startX: number } {
  if (n <= 0) return { cardW: RAIL_CARD_W, gap: RAIL_CARD_GAP, startX: RAIL_PAD_X };
  if (n === 1) {
    return {
      cardW: RAIL_CARD_W,
      gap: RAIL_CARD_GAP,
      startX: RAIL_PAD_X + Math.max(0, (inner - RAIL_CARD_W) / 2),
    };
  }
  const leftover = inner - n * RAIL_CARD_W;
  if (leftover >= RAIL_CARD_GAP * (n + 1)) {
    const gap = leftover / (n + 1);
    return { cardW: RAIL_CARD_W, gap, startX: RAIL_PAD_X + gap };
  }
  const fitW = Math.max(120, (inner - RAIL_CARD_GAP * (n - 1)) / n);
  return { cardW: fitW, gap: RAIL_CARD_GAP, startX: RAIL_PAD_X };
}

function isRailResident(task: OperationalTask): boolean {
  if ((SOFTWARE_RAIL_IDS as readonly string[]).includes(task.id)) return true;
  if ((MIDDLEWARE_IDS as readonly string[]).includes(task.id)) return true;
  if (task.zone === "Zone 5: Middleware Core") return true;
  return false;
}

function isHumanMiddleCard(task: OperationalTask): boolean {
  if (isRailResident(task)) return false;
  const nodeType = coerceOperationalNodeType(task.nodeType);
  if (nodeType === "gateway" || nodeType === "milestone") return true;
  return !isDigitalSocket(task);
}

function spineOrder(tasks: OperationalTask[]): OperationalTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered: OperationalTask[] = [];
  const seen = new Set<string>();
  for (const id of RETAIL_AZ_SPINE_ORDER) {
    const t = byId.get(id);
    if (t) {
      ordered.push(t);
      seen.add(id);
    }
  }
  for (const t of tasks) {
    if (!seen.has(t.id)) ordered.push(t);
  }
  return ordered;
}

function makeBeam(
  id: string,
  source: string,
  target: string,
  extra: Partial<BeamEdgeData> = {}
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: LR.sourceHandle,
    targetHandle: LR.targetHandle,
    type: "beam",
    zIndex: extra.feeder ? 3 : 1,
    data: {
      utility: classifyUtility(id, extra.utility),
      ...extra,
    },
  };
}

function taskNodeData(
  task: OperationalTask,
  accent: string,
  panelSlot: "breaker" | "socket"
) {
  const labels = labelsForZone(task.zone);
  const nodeType = coerceOperationalNodeType(task.nodeType);
  return {
    label: task.title,
    subtitle: task.duration,
    duration: task.duration,
    accent,
    zone: task.zone,
    operational: true,
    nodeType,
    panelSlot,
    techStack: task.techStack,
    cardKindLabel: panelSlot === "breaker" ? labels.cardKind : "Socket · Auto",
    roleBadge: roleBadgeForNode({ panelSlot, nodeType }),
  };
}

function durationToDwellMs(duration: string): number {
  const days = parseDurationDays(duration);
  if (days == null || days <= 0) return DWELL_MIN_MS;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, days * DAY_TO_DWELL_MS));
}

type ZoneGeom = {
  zone: OperationalZone;
  zoneId: string;
  x: number;
  width: number;
  height: number;
  ordered: OperationalTask[];
};

/**
 * Central snake — human middle-band cards only (L→R).
 * Satellite pings to GHL/software are handled by the sequence controller.
 */
export function buildLifecycleSnakeSequence(
  tasks: OperationalTask[],
  walkthroughOrJourneyId: string
): SequenceStep[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = snakeOrderForWalkthrough(walkthroughOrJourneyId);
  const present = order.filter((id) => byId.has(id) && isHumanMiddleCard(byId.get(id)!));
  const steps: SequenceStep[] = [];

  for (let i = 0; i < present.length; i++) {
    const id = present[i]!;
    const task = byId.get(id)!;
    const travel: string[] = [];
    if (i > 0) {
      travel.push(`snake-${present[i - 1]}-${id}`);
    }
    const sats = (SATELLITE_TARGETS[id] ?? []).filter(Boolean);
    steps.push({
      nodeId: id,
      travelEdges: travel,
      dwellMs: durationToDwellMs(task.duration),
      fanOutNodes: sats.length > 0 ? sats : undefined,
    });
  }
  return steps;
}

export function layoutHumanCanvas(
  tasks: OperationalTask[],
  _direction: LayoutDirection = "LR",
  options?: {
    walkthroughId?: WalkthroughId | null;
    processLinks?: ProcessLink[];
  }
): { nodes: Node[]; edges: Edge[] } {
  void _direction;
  const walkthroughId = options?.walkthroughId ?? null;
  if (!walkthroughId) {
    registerOperationalNodeZones(new Map());
    return { nodes: [], edges: [] };
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visibleIds = middleVisibleIdsForWalkthrough(walkthroughId);

  const humanTasks = tasks.filter((t) => {
    if (!isHumanMiddleCard(t)) return false;
    /* No walkthrough selected → no middle clutter until scenario chosen */
    if (!visibleIds) return false;
    return visibleIds.has(t.id);
  });
  const buckets = new Map<OperationalZone, OperationalTask[]>();
  for (const z of HUMAN_ZONES) buckets.set(z, []);
  for (const t of humanTasks) {
    if (buckets.has(t.zone)) buckets.get(t.zone)!.push(t);
    else buckets.get("Zone 0: Inbound Marketing")!.push(t);
  }

  /* ── Pass 1: uniform PCB banks (every zone same W×H; skip empty) ── */
  const geoms: ZoneGeom[] = [];

  for (const zone of HUMAN_ZONES) {
    const ordered = spineOrder(buckets.get(zone) ?? []);
    if (ordered.length === 0) continue;
    const zoneIdx = zoneIndexOf(zone);
    const zoneId = operationalZoneKey(zoneIdx);
    geoms.push({
      zone,
      zoneId,
      x: CANVAS_PAD,
      width: UNIFORM_ZONE_W,
      height: 0,
      ordered,
    });
  }

  const bankRows = Math.max(
    1,
    ...geoms.map((g) => Math.ceil(g.ordered.length / BANK_COLS) || 1)
  );
  const uniformH =
    geoms.length === 0
      ? 200
      : ZONE_HEADER_H + bankRows * ROW_PITCH + ZONE_FOOTER;
  for (const geom of geoms) {
    geom.width = UNIFORM_ZONE_W;
    geom.height = uniformH;
  }

  const previewStages = railStagesForWalkthrough(walkthroughId);
  const railMinW =
    previewStages.length > 0
      ? RAIL_PAD_X * 2 +
        previewStages.length * RAIL_CARD_W +
        Math.max(0, previewStages.length - 1) * RAIL_CARD_GAP
      : 0;
  const zoneCount = geoms.length;
  const totalZoneW = zoneCount * UNIFORM_ZONE_W;
  const minTraySpan =
    zoneCount > 1 ? totalZoneW + (zoneCount - 1) * SNAKE_TRAY_MIN : totalZoneW;
  const boardWidth = Math.max(960, minTraySpan, railMinW);

  /* Equal banks across the rail; leftover width is snake-tray lanes */
  if (zoneCount === 1) {
    geoms[0]!.x = CANVAS_PAD;
  } else if (zoneCount > 1) {
    const leftover = boardWidth - totalZoneW;
    const tray = leftover / (zoneCount - 1);
    let x = CANVAS_PAD;
    for (const geom of geoms) {
      geom.x = x;
      x += geom.width + tray;
    }
  }

  const zoneById = new Map<string, string>();
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const pushEdge = (edge: Edge) => {
    if (seenEdges.has(edge.id)) return;
    seenEdges.add(edge.id);
    edges.push(edge);
  };

  /* ── TOP RAIL: dynamic walkthrough stages, single full-width row ── */
  const railStages = previewStages;
  const ghlY = CANVAS_PAD;
  const ghlH = railStages.length > 0 ? GHL_RAIL_H : GHL_RAIL_EMPTY_H;
  const ghlW = boardWidth;

  nodes.push({
    id: "rail-ghl",
    type: "zone",
    position: { x: CANVAS_PAD, y: ghlY },
    data: {
      label: "GHL Pipelines",
      accent: "#a78bfa",
      panel: true,
      shortTitle:
        railStages.length > 0
          ? "GHL · CRM stages for selected walkthrough"
          : "GHL · select a Walkthrough to populate stages",
      hideEmptyColumn: true,
      railKind: "ghl",
      hasHumanColumn: false,
      hasDigitalColumn: false,
    },
    style: {
      width: ghlW,
      height: ghlH,
      zIndex: -2,
      overflow: "visible",
    },
    width: ghlW,
    height: ghlH,
    selectable: false,
    draggable: false,
  });
  zoneById.set("rail-ghl", "rail-ghl");

  if (railStages.length > 0) {
    const n = railStages.length;
    const inner = Math.max(200, ghlW - RAIL_PAD_X * 2);
    const { cardW, gap, startX } = railChipLayout(inner, n);
    const cardY = RAIL_LANE_H;

    railStages.forEach((stage, i) => {
      const chipId = ghlChipId(stage.stageId);
      const x = startX + i * (cardW + gap);
      nodes.push({
        id: chipId,
        type: "railCard",
        parentId: "rail-ghl",
        extent: "parent",
        position: { x, y: cardY },
        data: {
          label: stage.label,
          accent: stage.accent,
          subtitle: stage.pipelineLabel,
          railKind: "ghl",
          cardKindLabel: stage.gate ? "Gate" : "GHL Stage",
          roleBadge: stage.gate ? "GATEWAY" : "HUMAN",
          linkedTaskId: stage.stageId,
          ghlPipelineId: stage.pipelineId,
        },
        width: cardW,
        height: RAIL_CARD_H,
        style: { width: cardW, height: RAIL_CARD_H, zIndex: 28 },
        draggable: false,
      });
      zoneById.set(chipId, "rail-ghl");
    });
  }

  /* ── MIDDLE BAND ── */
  const zoneBandY = ghlY + ghlH + BAND_GAP;

  for (const geom of geoms) {
    const { zone, zoneId, x, width, ordered } = geom;
    const accent = OPERATIONAL_ZONE_ACCENT[zone];
    const labels = labelsForZone(zone);

    zoneById.set(zoneId, zoneId);
    zoneById.set(gridTieInId(zoneId), zoneId);
    zoneById.set(gridTieOutId(zoneId), zoneId);

    nodes.push({
      id: zoneId,
      type: "zone",
      position: { x, y: zoneBandY },
      data: {
        label: zone,
        accent,
        panel: true,
        humanColumn: labels.humanColumn,
        digitalColumn: "input → output",
        shortTitle: labels.shortTitle,
        hideEmptyColumn: true,
        hasHumanColumn: ordered.length > 0,
        hasDigitalColumn: false,
      },
      style: { width, height: uniformH, zIndex: -1, overflow: "visible" },
      width,
      height: uniformH,
      selectable: false,
      draggable: false,
    });

    nodes.push(
      {
        id: gridTieInId(zoneId),
        type: "gridTie",
        parentId: zoneId,
        extent: "parent",
        position: { x: 10, y: 36 },
        data: { zoneId, label: "IN", accent, kind: "in" },
        width: 48,
        height: 26,
        selectable: false,
        draggable: false,
      },
      {
        id: gridTieOutId(zoneId),
        type: "gridTie",
        parentId: zoneId,
        extent: "parent",
        position: { x: width - 58, y: 36 },
        data: { zoneId, label: "OUT", accent, kind: "out" },
        width: 48,
        height: 26,
        selectable: false,
        draggable: false,
      }
    );

    ordered.forEach((task, i) => {
      const col = Math.min(BANK_COLS - 1, Math.floor(i / bankRows));
      const row = i % bankRows;
      const size = cardSize(task);
      const px = PLUG_GUTTER_L + col * (CARD_W + COL_GAP);
      const py = ZONE_HEADER_H + row * ROW_PITCH;
      zoneById.set(task.id, zoneId);
      const nodeType = coerceOperationalNodeType(task.nodeType);
      const ft =
        nodeType === "gateway"
          ? "gateway"
          : nodeType === "milestone"
            ? "milestone"
            : "system";
      nodes.push({
        id: task.id,
        type: ft,
        parentId: zoneId,
        extent: "parent",
        position: { x: px, y: py },
        data: taskNodeData(task, accent, "breaker"),
        width: size.width,
        height: size.height,
        style: { width: size.width, height: size.height, zIndex: 24 },
        draggable: false,
      });
    });

    /* Intra-zone visual order is layout only — process wires come from the map. */
  }

  /* ── BOTTOM RAIL ── */
  const softY = zoneBandY + uniformH + BAND_GAP;
  const softwareFromTasks = SOFTWARE_RAIL_IDS.map((id) => byId.get(id)).filter(
    (t): t is OperationalTask => t != null
  );
  const middlewareFromTasks = MIDDLEWARE_IDS.map((id) => byId.get(id)).filter(
    (t): t is OperationalTask => t != null
  );

  type SoftItem = {
    id: string;
    title: string;
    accent: string;
    task: OperationalTask | null;
  };

  const softItems: SoftItem[] =
    softwareFromTasks.length > 0
      ? softwareFromTasks.map((t) => ({
          id: t.id,
          title: t.title,
          accent: "#22d3ee",
          task: t,
        }))
      : SOFTWARE_FALLBACK.map((s) => ({
          id: s.id,
          title: s.title,
          accent: s.accent,
          task: null,
        }));

  if (!softItems.some((s) => /woo/i.test(s.id) || /woo/i.test(s.title))) {
    softItems.splice(2, 0, {
      id: "sys-woo",
      title: "WooCommerce",
      accent: "#7dd3fc",
      task: null,
    });
  }

  const mwItems: SoftItem[] =
    middlewareFromTasks.length > 0
      ? middlewareFromTasks.map((t) => ({
          id: t.id,
          title: t.title,
          accent: "#67e8f9",
          task: t,
        }))
      : MIDDLEWARE_IDS.map((id) => ({
          id,
          title:
            id === "ingress"
              ? "Next.js Ingress"
              : id === "redis"
                ? "Redis L1"
                : id === "postgres"
                  ? "Postgres Outbox"
                  : "Inngest CCR",
          accent: "#67e8f9",
          task: null,
        }));

  const allBottom = [...softItems, ...mwItems];
  const softW = boardWidth;
  const softN = Math.max(1, allBottom.length);
  const softInner = Math.max(200, softW - RAIL_PAD_X * 2);
  const { cardW: softCardW, gap: softGap, startX: softStartX } =
    railChipLayout(softInner, softN);
  const softCardY = RAIL_LANE_H;

  nodes.push({
    id: "rail-software",
    type: "zone",
    position: { x: CANVAS_PAD, y: softY },
    data: {
      label: "Software Integrations",
      accent: "#22d3ee",
      panel: true,
      shortTitle: "Software Rail · Apps & Middleware",
      hideEmptyColumn: true,
      railKind: "systems",
    },
    style: {
      width: softW,
      height: SOFTWARE_RAIL_H,
      zIndex: -1,
      overflow: "visible",
    },
    width: softW,
    height: SOFTWARE_RAIL_H,
    selectable: false,
    draggable: false,
  });
  zoneById.set("rail-software", "rail-software");

  allBottom.forEach((item, i) => {
    const x = softStartX + i * (softCardW + softGap);
    zoneById.set(item.id, "rail-software");
    nodes.push({
      id: item.id,
      type: "railCard",
      parentId: "rail-software",
      extent: "parent",
      position: { x, y: softCardY },
      data: {
        label: item.title,
        accent: item.accent,
        subtitle:
          item.id === "katana" || item.id === "sys-woo"
            ? "Target Architecture"
            : (item.task?.techStack?.[0] ?? "Integration"),
        railKind: "software",
        cardKindLabel: "System App",
        roleBadge: "AUTO",
        linkedTaskId: item.task?.id,
      },
      width: softCardW,
      height: RAIL_CARD_H,
      style: { width: softCardW, height: RAIL_CARD_H, zIndex: 28 },
      draggable: false,
    });
  });

  /* Process wires after every node exists so GHL + software pings resolve. */
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const processLinks =
    options?.processLinks ??
    (walkthroughId ? seedProcessLinks(walkthroughId) : []);
  for (const edge of processLinksToEdges(processLinks, nodeIdSet)) {
    pushEdge(edge);
  }

  /* No permanent soft-rail beams — satellite pings only */

  for (let i = 0; i < geoms.length - 1; i++) {
    const a = geoms[i]!.zoneId;
    const b = geoms[i + 1]!.zoneId;
    pushEdge(
      makeBeam(`trunk-${a}-${b}`, gridTieOutId(a), gridTieInId(b), {
        gridLevel: "trunk",
        mutedBus: true,
      })
    );
  }

  registerOperationalNodeZones(zoneById);
  return { nodes, edges };
}

export {
  BLANK_SLOT_ID_PREFIX,
  HUMAN_ZONES,
  MIDDLEWARE_IDS,
  SOFTWARE_RAIL_IDS,
};
