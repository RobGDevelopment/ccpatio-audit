/**
 * MP&E town power grid — 9 substation enclosures, rack-mounted task cards,
 * one muted overhead TrunkBus. No ELK, no cross-zone spaghetti.
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
import type { SequenceStep } from "./sequences";
import { DWELL_MIN_MS, HOLD_MS } from "./sequences";
import type { BeamEdgeData } from "./BeamEdge";
import { RETAIL_AZ_SPINE_ORDER, operationalZoneKey } from "./retailAzSpine";
import {
  preparePlaybackSequence,
  warnSequenceIssues,
} from "../control/DependencyValidator";
import {
  classifyUtility,
  registerOperationalNodeZones,
} from "./utilityTypes";
import { labelsForZone, roleBadgeForNode } from "./zoneCardLabels";

const HEADER_H = 84;
const BOTTOM_PAD = 28;
const LEFT_X = 40;
const RIGHT_X = 360;
const ROW_PITCH = 100;
const BREAKER_SIZE = { width: 220, height: 88 };
const SOCKET_SIZE = { width: 200, height: 88 };
const GATEWAY_SIZE = { width: 112, height: 88 };
const GRID_TIE_SIZE = { width: 52, height: 32 };
const ZONE_WIDTH = RIGHT_X + SOCKET_SIZE.width + 40;
const SUBSTATION_GAP = 160;
const SUBSTATION_Y = 80;

const SOCKET_NODE_IDS = new Set([
  "ghl-hub",
  "sketchup",
  "payment-gateway",
  "qbo-deposit-link",
  "clover-showroom",
  "ingress",
  "redis",
  "postgres",
  "inngest",
  "katana",
  "qbo",
  "clover",
]);

function zoneIndexOf(zone: OperationalZone): number {
  const index = OPERATIONAL_ZONES.indexOf(zone);
  return index >= 0 ? index : 0;
}

/** Right-column digital/decision socket vs left-column physical breaker. */
export function isDigitalSocket(task: OperationalTask): boolean {
  const nodeType = coerceOperationalNodeType(task.nodeType);
  if (nodeType === "gateway" || nodeType === "milestone") return true;
  if (SOCKET_NODE_IDS.has(task.id)) return true;
  if (task.zone.startsWith("Zone 5:")) return true;
  return false;
}

function panelSize(task: OperationalTask): { width: number; height: number } {
  const nodeType = coerceOperationalNodeType(task.nodeType);
  if (nodeType === "gateway") return GATEWAY_SIZE;
  if (isDigitalSocket(task)) return SOCKET_SIZE;
  return BREAKER_SIZE;
}

function panelFlowType(task: OperationalTask): string {
  const nodeType = coerceOperationalNodeType(task.nodeType);
  if (nodeType === "gateway") return "gateway";
  if (nodeType === "milestone") return "milestone";
  if (isDigitalSocket(task)) return "socket";
  return "system";
}

export function gridTieInId(zoneId: string): string {
  return `gt-in-${zoneId}`;
}

export function gridTieOutId(zoneId: string): string {
  return `gt-out-${zoneId}`;
}

/** 10-week midpoint of the 8–12 week production line; 1 calendar day ≈ 1.6s on the beam. */
const DAY_TO_DWELL_MS = 1600;
const DWELL_MAX_MS = 12000;

const TECH_STACK_NODE: Record<string, string> = {
  ghl: "ghl-hub",
  inngest: "inngest",
  redis: "redis",
  upstash: "redis",
  postgres: "postgres",
  katana: "katana",
  qbo: "qbo",
  quickbooks: "qbo",
  clover: "clover",
};

export function durationToDwellMs(duration: string): number {
  const days = parseDurationDays(duration);
  if (days <= 0) return Math.max(DWELL_MIN_MS, HOLD_MS);
  return Math.round(
    Math.min(Math.max(days * DAY_TO_DWELL_MS, DWELL_MIN_MS), DWELL_MAX_MS)
  );
}

export function overheadBusEdgeId(fromIndex: number, toIndex: number): string {
  return `e-bus-z${fromIndex}-z${toIndex}`;
}

export function dropFeederEdgeId(zoneId: string, nodeId: string): string {
  return `e-drop-${zoneId}-${nodeId}`;
}

export function exitFeederEdgeId(zoneId: string, nodeId: string): string {
  return `e-exit-${zoneId}-${nodeId}`;
}

export function intraRackEdgeId(source: string, target: string): string {
  return `dep-${source}-${target}`;
}

function isGridTieIn(id: string): boolean {
  return id.startsWith("gt-in-");
}

function isGridTieOut(id: string): boolean {
  return id.startsWith("gt-out-");
}

function zoneIdFromTie(id: string): string | null {
  const match = id.match(/^gt-(?:in|out)-(z[0-8])$/);
  return match?.[1] ?? null;
}

/** True when an edge would jump a zone's IN straight to its own OUT. */
export function isIntraZoneTieShort(source: string, target: string): boolean {
  if (!isGridTieIn(source) || !isGridTieOut(target)) return false;
  const from = zoneIdFromTie(source);
  const to = zoneIdFromTie(target);
  return from != null && from === to;
}

/** Strict RF handles: breakers L/T in, R/B out; sockets L in, R/B out. */
function circuitHandles(): { sourceHandle: string; targetHandle: string } {
  // Universal Left-In / Right-Out — cards only expose left/right handles.
  return { sourceHandle: "right", targetHandle: "left" };
}

function topoSortZone(tasks: OperationalTask[]): OperationalTask[] {
  const ids = new Set(tasks.map((task) => task.id));
  const remaining = new Map(tasks.map((task) => [task.id, task]));
  const indeg = new Map(tasks.map((task) => [task.id, 0]));
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (ids.has(dep) && dep !== task.id) {
        indeg.set(task.id, (indeg.get(task.id) ?? 0) + 1);
      }
    }
  }

  const ordered: OperationalTask[] = [];
  const ready = () =>
    [...remaining.values()].filter((task) => (indeg.get(task.id) ?? 0) === 0);

  while (remaining.size > 0) {
    const next = ready();
    const pick = next[0] ?? [...remaining.values()][0];
    if (!pick) break;
    ordered.push(pick);
    remaining.delete(pick.id);
    for (const task of remaining.values()) {
      if (task.dependencies.includes(pick.id)) {
        indeg.set(task.id, Math.max(0, (indeg.get(task.id) ?? 1) - 1));
      }
    }
  }
  return ordered;
}

function rackOrder(tasks: OperationalTask[]): OperationalTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const spine = RETAIL_AZ_SPINE_ORDER.map((id) => byId.get(id)).filter(
    (task): task is OperationalTask => task != null
  );
  const spineIds = new Set(spine.map((task) => task.id));
  const rest = topoSortZone(tasks.filter((task) => !spineIds.has(task.id)));
  return [...spine, ...rest];
}

function resolveTriggerToken(
  token: string,
  taskIds: Set<string>
): string | null {
  if (taskIds.has(token)) return token;
  if (token.includes("::")) {
    const stage = token.split("::")[1];
    if (stage && taskIds.has(stage)) return stage;
  }
  return null;
}

function techStackTargets(stack: string[], taskIds: Set<string>): string[] {
  const hits: string[] = [];
  for (const item of stack) {
    const key = item.trim().toLowerCase();
    for (const [needle, nodeId] of Object.entries(TECH_STACK_NODE)) {
      if (key.includes(needle) && taskIds.has(nodeId)) hits.push(nodeId);
    }
  }
  return hits;
}

export function resolveOperationalTriggerTargets(
  task: OperationalTask,
  taskIds: Set<string>
): string[] {
  const fromTriggers = task.digitalTriggers
    .map((token) => resolveTriggerToken(token, taskIds))
    .filter((id): id is string => id != null);
  const fromStack = techStackTargets(task.techStack, taskIds);
  return [...new Set([...fromTriggers, ...fromStack])].filter(
    (id) => id !== task.id
  );
}

function makeBeamEdge(
  id: string,
  source: string,
  target: string,
  extra: Partial<BeamEdgeData> & {
    sourceHandle?: string;
    targetHandle?: string;
  } = {}
): Edge {
  const { sourceHandle, targetHandle, ...data } = extra;
  return {
    id,
    source,
    target,
    sourceHandle: sourceHandle ?? "right",
    targetHandle: targetHandle ?? "left",
    type: "beam",
    zIndex: data.feeder ? 3 : 1,
    data: {
      utility: classifyUtility(id, data.utility),
      ...data,
    },
  };
}

export function layoutOperationalTownGrid(tasks: OperationalTask[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const zoneById = new Map<string, string>();
  const buckets = new Map<OperationalZone, OperationalTask[]>();
  for (const zone of OPERATIONAL_ZONES) buckets.set(zone, []);
  for (const task of tasks) {
    const index = zoneIndexOf(task.zone);
    const zoneId = operationalZoneKey(index);
    zoneById.set(task.id, zoneId);
    buckets.get(task.zone)?.push(task);
  }
  for (let i = 0; i < OPERATIONAL_ZONES.length; i++) {
    const zoneId = operationalZoneKey(i);
    zoneById.set(zoneId, zoneId);
    zoneById.set(gridTieInId(zoneId), zoneId);
    zoneById.set(gridTieOutId(zoneId), zoneId);
  }
  registerOperationalNodeZones(zoneById);

  const substations: Node[] = [];
  const racks: Node[] = [];
  const ties: Node[] = [];
  const slotById = new Map<string, "breaker" | "socket">();
  let cursorX = 40;

  for (let index = 0; index < OPERATIONAL_ZONES.length; index++) {
    const zone = OPERATIONAL_ZONES[index]!;
    const zoneId = operationalZoneKey(index);
    const ordered = rackOrder(buckets.get(zone) ?? []);
    const hasBreakers = ordered.some((task) => !isDigitalSocket(task));
    const hasSockets = ordered.some((task) => isDigitalSocket(task));
    /** Collapse empty human column (e.g. Zone 5 middleware = sockets only). */
    const socketColX = hasBreakers ? RIGHT_X : LEFT_X;
    const width =
      hasBreakers && hasSockets
        ? ZONE_WIDTH
        : LEFT_X +
          (hasSockets ? SOCKET_SIZE.width : BREAKER_SIZE.width) +
          40;

    const placements: {
      task: OperationalTask;
      x: number;
      y: number;
      socket: boolean;
    }[] = [];

    let leftY = HEADER_H;
    let rightY = HEADER_H;
    for (const task of ordered) {
      const socket = isDigitalSocket(task);
      const x = socket ? socketColX : LEFT_X;
      const y = socket ? rightY : leftY;
      placements.push({ task, x, y, socket });
      if (socket) rightY += ROW_PITCH;
      else leftY += ROW_PITCH;
    }

    const stackBottom = Math.max(
      HEADER_H + BREAKER_SIZE.height,
      ...placements.map((place) => place.y + panelSize(place.task).height)
    );
    const height = stackBottom + BOTTOM_PAD;
    const accent = OPERATIONAL_ZONE_ACCENT[zone];
    const zoneLabels = labelsForZone(zone);

    substations.push({
      id: zoneId,
      type: "zone",
      position: { x: cursorX, y: SUBSTATION_Y },
      data: {
        label: zone,
        accent,
        panel: true,
        humanColumn: zoneLabels.humanColumn,
        digitalColumn: zoneLabels.digitalColumn,
        shortTitle: zoneLabels.shortTitle,
        hideEmptyColumn: !hasBreakers || !hasSockets,
        hasHumanColumn: hasBreakers,
        hasDigitalColumn: hasSockets,
      },
      style: { width, height, zIndex: -1, overflow: "visible" },
      width,
      height,
      selectable: false,
      draggable: false,
    });

    ties.push(
      {
        id: gridTieInId(zoneId),
        type: "gridTie",
        parentId: zoneId,
        extent: "parent",
        position: { x: 6, y: 8 },
        data: {
          zoneId,
          label: "IN",
          accent,
          kind: "in",
        },
        width: GRID_TIE_SIZE.width,
        height: GRID_TIE_SIZE.height,
        style: {
          width: GRID_TIE_SIZE.width,
          height: GRID_TIE_SIZE.height,
          zIndex: 30,
        },
        selectable: false,
        draggable: false,
      },
      {
        id: gridTieOutId(zoneId),
        type: "gridTie",
        parentId: zoneId,
        extent: "parent",
        position: { x: width - GRID_TIE_SIZE.width - 6, y: 8 },
        data: {
          zoneId,
          label: "OUT",
          accent,
          kind: "out",
        },
        width: GRID_TIE_SIZE.width,
        height: GRID_TIE_SIZE.height,
        style: {
          width: GRID_TIE_SIZE.width,
          height: GRID_TIE_SIZE.height,
          zIndex: 30,
        },
        selectable: false,
        draggable: false,
      }
    );

    const seenXY = new Set<string>();
    for (const place of placements) {
      const nodeType = coerceOperationalNodeType(place.task.nodeType);
      const size = panelSize(place.task);
      const key = `${place.x},${place.y}`;
      if (seenXY.has(key)) {
        throw new Error(
          `Panel stacking collision in ${zoneId}: ${place.task.id} at ${key}`
        );
      }
      seenXY.add(key);
      slotById.set(place.task.id, place.socket ? "socket" : "breaker");
      racks.push({
        id: place.task.id,
        type: panelFlowType(place.task),
        parentId: zoneId,
        extent: "parent",
        position: { x: place.x, y: place.y },
        data: {
          label: place.task.title,
          subtitle: place.task.duration,
          duration: place.task.duration,
          accent,
          zone: place.task.zone,
          operational: true,
          nodeType,
          panelSlot: place.socket ? "socket" : "breaker",
          techStack: place.task.techStack,
          cardKindLabel: place.socket
            ? "Socket · Auto"
            : labelsForZone(place.task.zone).cardKind,
          roleBadge: roleBadgeForNode({
            panelSlot: place.socket ? "socket" : "breaker",
            nodeType,
          }),
        },
        width: size.width,
        height: size.height,
        style: { width: size.width, height: size.height, zIndex: 24 },
        draggable: false,
      });
    }

    cursorX += width + SUBSTATION_GAP;
  }

  const taskIds = new Set(tasks.map((task) => task.id));
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const pushCircuitEdge = (
    id: string,
    source: string,
    target: string,
    extra: Partial<BeamEdgeData> = {},
    type: "beam" | "trunkBus" = "beam"
  ) => {
    if (isIntraZoneTieShort(source, target)) return;
    if (seen.has(id)) return;
    seen.add(id);
    const handles = circuitHandles();
    if (type === "trunkBus") {
      edges.push({
        id,
        source,
        target,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: "trunkBus",
        zIndex: 0,
        data: extra,
      });
      return;
    }
    edges.push(
      makeBeamEdge(id, source, target, {
        ...extra,
        ...handles,
      })
    );
  };

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep) || dep === task.id) continue;
      if (zoneById.get(dep) !== zoneById.get(task.id)) continue;
      pushCircuitEdge(intraRackEdgeId(dep, task.id), dep, task.id, {
        gridLevel: "local",
      });
    }
  }

  for (let i = 0; i < RETAIL_AZ_SPINE_ORDER.length - 1; i++) {
    const source = RETAIL_AZ_SPINE_ORDER[i]!;
    const target = RETAIL_AZ_SPINE_ORDER[i + 1]!;
    if (!taskIds.has(source) || !taskIds.has(target)) continue;
    if (zoneById.get(source) !== zoneById.get(target)) continue;
    pushCircuitEdge(intraRackEdgeId(source, target), source, target, {
      gridLevel: "local",
    });
  }

  const spineByZone = RETAIL_AZ_SPINE_ORDER.filter((id) => taskIds.has(id));

  /* Trunk → IN → task on every zone entry; task → OUT → trunk on every exit.
     Skipped zones never receive an IN hop. Never IN → own OUT. */
  if (spineByZone[0]) {
    const first = spineByZone[0];
    const zoneId = zoneById.get(first);
    if (zoneId) {
      pushCircuitEdge(
        dropFeederEdgeId(zoneId, first),
        gridTieInId(zoneId),
        first,
        { feeder: true, drop: true, brief: true, gridLevel: "branch" }
      );
    }
  }

  for (let i = 0; i < spineByZone.length - 1; i++) {
    const source = spineByZone[i]!;
    const target = spineByZone[i + 1]!;
    const fromZone = zoneById.get(source);
    const toZone = zoneById.get(target);
    if (!fromZone || !toZone || fromZone === toZone) continue;
    pushCircuitEdge(
      exitFeederEdgeId(fromZone, source),
      source,
      gridTieOutId(fromZone),
      { feeder: true, drop: true, brief: true, gridLevel: "branch" }
    );
    const fromIndex = Number(fromZone.slice(1));
    const toIndex = Number(toZone.slice(1));
    pushCircuitEdge(
      overheadBusEdgeId(fromIndex, toIndex),
      gridTieOutId(fromZone),
      gridTieInId(toZone),
      {
        mutedBus: true,
        interZone: true,
        gridLevel: "trunk",
        utility: "digital",
        label: "Master trunk",
      } satisfies BeamEdgeData,
      "trunkBus"
    );
    pushCircuitEdge(
      dropFeederEdgeId(toZone, target),
      gridTieInId(toZone),
      target,
      { feeder: true, drop: true, brief: true, gridLevel: "branch" }
    );
  }

  const last = spineByZone[spineByZone.length - 1];
  if (last) {
    const zoneId = zoneById.get(last);
    if (zoneId) {
      pushCircuitEdge(
        exitFeederEdgeId(zoneId, last),
        last,
        gridTieOutId(zoneId),
        { feeder: true, drop: true, brief: true, gridLevel: "branch" }
      );
    }
  }

  return { nodes: [...substations, ...ties, ...racks], edges };
}

function busHopsBetween(fromZone: string, toZone: string): string[] {
  const from = Number(fromZone.slice(1));
  const to = Number(toZone.slice(1));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
  /* Single overhead hop — skipped zones are not entered via their IN tie */
  return [overheadBusEdgeId(from, to)];
}

export function buildOperationalRetailSequence(
  tasks: OperationalTask[]
): SequenceStep[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const taskIds = new Set(byId.keys());
  const spineCandidates = RETAIL_AZ_SPINE_ORDER.filter((id) => taskIds.has(id));
  const { orderedIds: spine, issues } = preparePlaybackSequence(
    spineCandidates,
    tasks
  );
  if (issues.length > 0) {
    warnSequenceIssues(issues);
  }

  return spine.map((id, index) => {
    const task = byId.get(id)!;
    const prev = index > 0 ? spine[index - 1]! : null;
    const travelEdges: string[] = [];
    const zone = operationalZoneKey(zoneIndexOf(task.zone));
    if (!prev) {
      travelEdges.push(dropFeederEdgeId(zone, id));
    } else {
      const prevZone = operationalZoneKey(zoneIndexOf(byId.get(prev)!.zone));
      if (prevZone === zone) {
        travelEdges.push(intraRackEdgeId(prev, id));
      } else {
        travelEdges.push(exitFeederEdgeId(prevZone, prev));
        travelEdges.push(...busHopsBetween(prevZone, zone));
        travelEdges.push(dropFeederEdgeId(zone, id));
      }
    }

    return {
      nodeId: id,
      travelEdges,
      dwellMs: durationToDwellMs(task.duration),
      fanOutNodes: resolveOperationalTriggerTargets(task, taskIds),
    };
  });
}

export function collectOperationalTriggerFeeders(
  originId: string,
  tasks: OperationalTask[]
): { nodeIds: string[]; zoneIds: string[]; edges: Edge[]; edgeIds: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const taskIds = new Set(byId.keys());
  const origin = byId.get(originId);
  if (!origin) {
    return { nodeIds: [], zoneIds: [], edges: [], edgeIds: [] };
  }

  const originZone = operationalZoneKey(zoneIndexOf(origin.zone));
  const targets = resolveOperationalTriggerTargets(origin, taskIds)
    .map((id) => byId.get(id))
    .filter((task): task is OperationalTask => task != null)
    .filter(
      (task) =>
        operationalZoneKey(zoneIndexOf(task.zone)) !== originZone
    )
    .slice(0, 4);

  const edges = targets.map((task) =>
    makeBeamEdge(`e-trig-${originId}-${task.id}`, originId, task.id, {
      feeder: true,
      brief: true,
      gridLevel: "branch",
      utility: classifyUtility(`e-trig-${originId}-${task.id}`),
      sourceHandle: "right",
      targetHandle: "left",
    })
  );

  const zoneIds = [
    ...new Set(
      targets.map((task) =>
        operationalZoneKey(zoneIndexOf(task.zone))
      )
    ),
  ];

  return {
    nodeIds: targets.map((task) => task.id),
    zoneIds,
    edges,
    edgeIds: edges.map((edge) => edge.id),
  };
}
