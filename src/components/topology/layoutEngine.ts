import dagre from "dagre";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { CSSProperties } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowStep } from "../../schema/schemaTypes";
import {
  OPERATIONAL_ZONES,
  OPERATIONAL_ZONE_ACCENT,
  coerceOperationalNodeType,
  type OperationalNodeType,
  type OperationalTask,
  type OperationalZone,
} from "../../schema/operationalTask";
import { granularNodeId } from "./granularGraph";
import { isRetailAzSpineEdge } from "./retailAzSpine";
import {
  isDigitalSocket,
  layoutOperationalTownGrid,
} from "./operationalTownGrid";
import { layoutHumanCanvas } from "./humanCanvasLayout";
import type { WalkthroughId } from "./ghlPipelines";
import type { ProcessLink } from "./processMap";

export type LayoutDirection = "LR" | "TB";
export type LayoutEngineId = "grid" | "dagre" | "elk" | "humanCanvas";

export { RETAIL_AZ_SPINE_NODE_IDS, isRetailAzSpineEdge } from "./retailAzSpine";

export const OPERATIONAL_NODE_SIZE: Record<
  OperationalNodeType,
  { width: number; height: number }
> = {
  standard: { width: 220, height: 72 },
  gateway: { width: 140, height: 140 },
  milestone: { width: 280, height: 96 },
};

const FLOW_TYPE: Record<OperationalNodeType, string> = {
  standard: "system",
  gateway: "gateway",
  milestone: "milestone",
};

const ZONE_BAND_PAD = 80;
const ZONE_BAND_PREFIX = "op-zone-band-";
const OPERATIONAL_EDGE_RADIUS = 12;
const COLUMN_GAP = 80;

const elk = new ELK();

function operationalEdgeStyle(crossZone: boolean, spine: boolean): CSSProperties {
  if (spine) {
    return crossZone
      ? { stroke: "#475569", strokeWidth: 2.8, opacity: 0.78 }
      : { stroke: "#334155", strokeWidth: 2.2, opacity: 0.9 };
  }
  return crossZone
    ? { stroke: "#94a3b8", strokeWidth: 2.6, opacity: 0.42 }
    : { stroke: "#64748b", strokeWidth: 1.4, opacity: 0.72 };
}

function makeOperationalEdge(
  id: string,
  source: string,
  target: string,
  crossZone: boolean,
  spine: boolean,
  direction: LayoutDirection = "LR"
): Edge {
  void direction;
  const sourceHandle = "right";
  const targetHandle = "left";
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "beam",
    data: { operational: true, crossZone, spine, mutedBus: true },
    animated: false,
    style: { opacity: 0, strokeOpacity: 0 },
  } as Edge;
}

export function operationalZoneIndex(zone: OperationalZone): number {
  const index = OPERATIONAL_ZONES.indexOf(zone);
  return index >= 0 ? index : 0;
}

export function isOperationalZoneBandId(id: string): boolean {
  return id.startsWith(ZONE_BAND_PREFIX);
}

function resolveBlueprintNodeId(
  step: WorkflowStep,
  nodeById: Map<string, Node>
): string | null {
  const granular = granularNodeId(step.nodeId, step.stageId);
  if (nodeById.has(granular)) return granular;
  if (nodeById.has(step.nodeId)) return step.nodeId;
  return null;
}

function nodeDimensions(node: Node): { width: number; height: number } {
  const fallback = OPERATIONAL_NODE_SIZE.standard;
  return {
    width: node.measured?.width ?? node.width ?? fallback.width,
    height: node.measured?.height ?? node.height ?? fallback.height,
  };
}

function isDigitalColumnNode(node: Node): boolean {
  const data = node.data as { nodeType?: OperationalNodeType; panelSlot?: string } | undefined;
  if (data?.panelSlot === "socket") return true;
  if (data?.panelSlot === "breaker") return false;
  if (data?.nodeType === "gateway" || data?.nodeType === "milestone") return true;
  return false;
}

/** Lock human/standard cards to one X and digital/gateway cards to another within each zone. */
function snapDualColumns(nodes: Node[]): Node[] {
  const groups = new Map<OperationalZone, { left: Node[]; right: Node[] }>();
  for (const node of nodes) {
    if (isOperationalZoneBandId(node.id)) continue;
    const zone = (node.data as { zone?: OperationalZone } | undefined)?.zone;
    if (!zone) continue;
    const group = groups.get(zone) ?? { left: [], right: [] };
    if (isDigitalColumnNode(node)) group.right.push(node);
    else group.left.push(node);
    groups.set(zone, group);
  }

  const snappedX = new Map<string, number>();
  for (const { left, right } of groups.values()) {
    if (left.length > 0 && right.length > 0) {
      const leftX = Math.min(...left.map((node) => node.position.x));
      const leftWidth = Math.max(
        ...left.map((node) => nodeDimensions(node).width)
      );
      const rightX = Math.max(
        Math.min(...right.map((node) => node.position.x)),
        leftX + leftWidth + COLUMN_GAP
      );
      for (const node of left) snappedX.set(node.id, leftX);
      for (const node of right) snappedX.set(node.id, rightX);
      continue;
    }
    if (left.length > 0) {
      const leftX = Math.min(...left.map((node) => node.position.x));
      for (const node of left) snappedX.set(node.id, leftX);
    }
    if (right.length > 0) {
      const rightX = Math.min(...right.map((node) => node.position.x));
      for (const node of right) snappedX.set(node.id, rightX);
    }
  }

  return nodes.map((node) => {
    const x = snappedX.get(node.id);
    if (x == null) return node;
    return { ...node, position: { x, y: node.position.y } };
  });
}

function buildUnpositionedOperationalGraph(
  tasks: OperationalTask[],
  direction: LayoutDirection = "LR"
): {
  nodes: Node[];
  edges: Edge[];
  zoneById: Map<string, OperationalZone>;
} {
  const zoneById = new Map<string, OperationalZone>();
  const nodes: Node[] = tasks.map((task) => {
    const nodeType = coerceOperationalNodeType(task.nodeType);
    const size = OPERATIONAL_NODE_SIZE[nodeType];
    zoneById.set(task.id, task.zone);
    return {
      id: task.id,
      type: FLOW_TYPE[nodeType],
      position: { x: 0, y: 0 },
      data: {
        label: task.title,
        subtitle: `${task.duration}${task.techStack.length ? ` · ${task.techStack.join(", ")}` : ""}`,
        accent: OPERATIONAL_ZONE_ACCENT[task.zone],
        zone: task.zone,
        operational: true,
        nodeType,
        panelSlot: isDigitalSocket(task) ? "socket" : "breaker",
      },
      width: size.width,
      height: size.height,
    };
  });

  const taskIds = new Set(tasks.map((task) => task.id));
  const edges: Edge[] = [];
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep) || dep === task.id) continue;
      const crossZone = zoneById.get(dep) !== task.zone;
      const spine = isRetailAzSpineEdge(dep, task.id);
      edges.push(
        makeOperationalEdge(
          `dep-${dep}-${task.id}`,
          dep,
          task.id,
          crossZone,
          spine,
          direction
        )
      );
    }
  }

  if (edges.length === 0 && tasks.length > 1) {
    for (let i = 0; i < tasks.length - 1; i++) {
      const source = tasks[i].id;
      const target = tasks[i + 1].id;
      const spine = isRetailAzSpineEdge(source, target);
      edges.push(
        makeOperationalEdge(
          `seq-${source}-${target}`,
          source,
          target,
          false,
          spine,
          direction
        )
      );
    }
  }

  return { nodes, edges, zoneById };
}

function appendVisualZoneBands(nodes: Node[]): Node[] {
  const taskNodes = nodes.filter((node) => !isOperationalZoneBandId(node.id));
  const buckets = new Map<
    OperationalZone,
    { minX: number; minY: number; maxX: number; maxY: number }
  >();

  for (const node of taskNodes) {
    const zone = node.data && typeof node.data === "object"
      ? (node.data as { zone?: OperationalZone }).zone
      : undefined;
    if (!zone) continue;
    const { width, height } = nodeDimensions(node);
    const box = buckets.get(zone) ?? {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    box.minX = Math.min(box.minX, node.position.x);
    box.minY = Math.min(box.minY, node.position.y);
    box.maxX = Math.max(box.maxX, node.position.x + width);
    box.maxY = Math.max(box.maxY, node.position.y + height);
    buckets.set(zone, box);
  }

  const bands: Node[] = [];
  for (const zone of OPERATIONAL_ZONES) {
    const box = buckets.get(zone);
    if (!box || !Number.isFinite(box.minX)) continue;
    const index = operationalZoneIndex(zone);
    const width = box.maxX - box.minX + ZONE_BAND_PAD * 2;
    const height = box.maxY - box.minY + ZONE_BAND_PAD * 2;
    bands.push({
      id: `${ZONE_BAND_PREFIX}${index}`,
      type: "zone",
      position: { x: box.minX - ZONE_BAND_PAD, y: box.minY - ZONE_BAND_PAD },
      data: { label: zone, accent: OPERATIONAL_ZONE_ACCENT[zone] },
      style: { width, height, zIndex: -1 },
      width,
      height,
      selectable: false,
      draggable: false,
    });
  }

  return [...bands, ...taskNodes];
}

/** Dagre fallback for the operational map. */
export function layoutOperationalTasksDagre(
  tasks: OperationalTask[],
  direction: LayoutDirection = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const { nodes, edges } = buildUnpositionedOperationalGraph(tasks, direction);
  const { layoutedNodes, layoutedEdges } = getLayoutedElements(
    nodes,
    edges,
    direction
  );
  return {
    nodes: appendVisualZoneBands(snapDualColumns(layoutedNodes)),
    edges: layoutedEdges,
  };
}

const ELK_PORT_SIDE: Record<"west" | "east" | "north" | "south", string> = {
  west: "WEST",
  east: "EAST",
  north: "NORTH",
  south: "SOUTH",
};

function elkPortsForNode(nodeId: string): NonNullable<ElkNode["ports"]> {
  return (["west", "east", "north", "south"] as const).map((side) => ({
    id: `${nodeId}:${side}`,
    layoutOptions: {
      "elk.port.side": ELK_PORT_SIDE[side],
    },
  }));
}

/** Flat partitioned ELK layout — no React Flow parentNode. */
export async function layoutOperationalTasksElk(
  tasks: OperationalTask[],
  direction: LayoutDirection = "LR"
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const { nodes, edges, zoneById } = buildUnpositionedOperationalGraph(
    tasks,
    direction
  );
  const elkDirection = direction === "TB" ? "DOWN" : "RIGHT";
  const sourcePort = direction === "TB" ? "south" : "east";
  const targetPort = direction === "TB" ? "north" : "west";

  const graph: ElkNode = {
    id: "operational-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.portConstraints": "FIXED_SIDE",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.partitioning.activate": "true",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.spacing.edgeNode": "48",
      "elk.spacing.edgeEdge": "32",
      "elk.padding": "[top=100,left=60,bottom=60,right=60]",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.layered.spacing.edgeNodeBetweenLayers": "60",
    },
    children: nodes.map((node) => {
      const { width, height } = nodeDimensions(node);
      const zone = zoneById.get(node.id) ?? OPERATIONAL_ZONES[0];
      const zoneIndex = operationalZoneIndex(zone);
      const digital = isDigitalColumnNode(node);
      /* LR: even partition = left (human), odd = right (digital) inside each zone.
         TB: keep one partition per zone so bands stack; alignment still pins columns. */
      const partition =
        direction === "LR" ? zoneIndex * 2 + (digital ? 1 : 0) : zoneIndex;
      return {
        id: node.id,
        width,
        height,
        ports: elkPortsForNode(node.id),
        layoutOptions: {
          "elk.partitioning.partition": String(partition),
          "elk.portConstraints": "FIXED_SIDE",
          "elk.alignment": digital ? "RIGHT" : "LEFT",
        },
      };
    }),
    edges: edges.map((edge) => {
      const crossZone = zoneById.get(edge.source) !== zoneById.get(edge.target);
      const spine = isRetailAzSpineEdge(edge.source, edge.target);
      return {
        id: edge.id,
        sources: [`${edge.source}:${sourcePort}`],
        targets: [`${edge.target}:${targetPort}`],
        layoutOptions: {
          ...(crossZone
            ? { "elk.layered.unnecessaryBendpoints": "true" }
            : {}),
          ...(spine
            ? {
                "elk.priority": "10",
                "elk.edge.priority": "10",
                "elk.layered.priority.straightness": "10",
              }
            : {}),
        },
      };
    }),
  };

  const laidOut = await elk.layout(graph);
  const placed = new Map(
    (laidOut.children ?? []).map((child) => [child.id, child])
  );

  const layoutedNodes = snapDualColumns(
    nodes.map((node) => {
      const elkNode = placed.get(node.id);
      return {
        ...node,
        position: {
          x: elkNode?.x ?? node.position.x,
          y: elkNode?.y ?? node.position.y,
        },
      };
    })
  );

  return {
    nodes: appendVisualZoneBands(layoutedNodes),
    edges,
  };
}

export async function layoutOperationalTasks(
  tasks: OperationalTask[],
  engine: LayoutEngineId,
  direction: LayoutDirection,
  options?: {
    heldTaskIds?: string[];
    walkthroughId?: WalkthroughId | null;
    processLinks?: ProcessLink[];
  }
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const visible = options?.heldTaskIds?.length
    ? tasks.filter((t) => !options.heldTaskIds!.includes(t.id))
    : tasks;

  if (engine === "humanCanvas") {
    return layoutHumanCanvas(visible, direction, {
      walkthroughId: options?.walkthroughId ?? null,
      processLinks: options?.processLinks,
    });
  }
  if (engine === "grid") {
    /* Dual-column MP&E panel layout (unique Y per child, IN/OUT grid ties). */
    return layoutOperationalTownGrid(visible);
  }
  if (engine === "elk") {
    try {
      return await layoutOperationalTasksElk(visible, direction);
    } catch (err) {
      console.warn("ELK layout failed, falling back to Dagre", err);
      return layoutOperationalTasksDagre(visible, direction);
    }
  }
  return layoutOperationalTasksDagre(visible, direction);
}

/** @deprecated Prefer layoutOperationalTasksDagre / layoutOperationalTasks */
export function buildOperationalTaskLayoutGraph(
  tasks: OperationalTask[]
): { nodes: Node[]; edges: Edge[] } {
  return layoutOperationalTasksDagre(tasks, "LR");
}

/** Build a Dagre input graph driven by blueprint step order (falls back to full compiled graph). */
export function buildBlueprintLayoutGraph(
  blueprint: WorkflowStep[],
  compiledNodes: Node[],
  compiledEdges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  if (blueprint.length === 0) {
    return { nodes: compiledNodes, edges: compiledEdges };
  }

  const nodeById = new Map(compiledNodes.map((n) => [n.id, n]));
  const orderedIds = blueprint
    .map((step) => resolveBlueprintNodeId(step, nodeById))
    .filter((id): id is string => id != null);

  const uniqueIds = [...new Set(orderedIds)];
  if (uniqueIds.length === 0) {
    return { nodes: compiledNodes, edges: compiledEdges };
  }

  const seqNodes = uniqueIds
    .map((id) => nodeById.get(id))
    .filter((n): n is Node => n != null);

  const seqEdges: Edge[] = [];
  for (let i = 0; i < orderedIds.length - 1; i++) {
    const source = orderedIds[i];
    const target = orderedIds[i + 1];
    if (source === target) continue;
    seqEdges.push({
      id: `bp-seq-${source}-${target}-${i}`,
      source,
      target,
      sourceHandle: "right",
      targetHandle: "left",
      type: "trunkBus",
    });
  }

  const { layoutedNodes } = getLayoutedElements(seqNodes, seqEdges, "LR");
  const layoutedById = new Map(layoutedNodes.map((n) => [n.id, n]));

  const mergedNodes = compiledNodes.map((n) => layoutedById.get(n.id) ?? n);
  return { nodes: mergedNodes, edges: compiledEdges };
}

export type DagreRanker = "network-simplex" | "tight-tree" | "longest-path";

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "LR",
  ranker: DagreRanker = "network-simplex"
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    ranker,
    nodesep: 20,
    ranksep: 40,
    edgesep: 12,
    marginx: 16,
    marginy: 16,
  });

  nodes.forEach((node) => {
    const { width, height } = nodeDimensions(node);
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const { width, height } = nodeDimensions(node);
    const newNode = { ...node };
    if (!nodeWithPosition) {
      return newNode;
    }
    newNode.position = {
      x: nodeWithPosition.x - width / 2,
      y: nodeWithPosition.y - height / 2,
    };
    return newNode;
  });

  return { layoutedNodes, layoutedEdges: edges };
}
