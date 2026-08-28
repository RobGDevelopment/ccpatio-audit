/**
 * Adapter: compile MasterWorkflowSchema from current TS topology / sequences / calendar.
 */

import type { Edge, Node } from "@xyflow/react";
import {
  SEQUENCES,
  BOARD_SEQUENCES,
  JOURNEY_LABELS,
  EXCEPTION_JOURNEYS,
  type JourneyId,
  type SequenceStep,
} from "../components/topology/sequences";
import { initialNodes, initialEdges } from "../components/topology/topologyData";
import { buildGranularGraph } from "../components/topology/granularGraph";
import {
  lookupCalendar,
  type DwellCalendarEntry,
} from "../components/topology/dwellCalendar";
import { zoneOfNode, classifyUtility, classifyGridLevel, isDataCable } from "../components/topology/utilityTypes";
import { ZONE_LAYOUTS, ZONE_H } from "../components/topology/zoneLayout";
import type { PipelineNodeData, SystemNodeData, ZoneNodeData } from "../components/topology/nodes";
import type { GridTieNodeData } from "../components/topology/zoneLayout";
import type {
  MasterWorkflowSchema,
  WorkflowDef,
  WorkflowEdge,
  WorkflowNode,
  WorkflowStep,
  WorkOrderInstance,
} from "./schemaTypes";
import { buildDemoWorkOrders } from "./demoWorkOrders";

function inferIntegration(id: string): WorkflowNode["integration"] {
  if (id === "ingress" || id.includes("ingress")) return "ingress";
  if (id === "katana" || id.includes("katana")) return "katana";
  if (id.includes("qbo") || id === "qbo") return "qbo";
  if (id.includes("clover")) return "clover";
  if (id === "inngest") return "inngest";
  if (id === "redis") return "redis";
  if (id === "postgres") return "postgres";
  if (id.includes("ghl") || id.includes("mfg-pipe") || id.includes("sales-") || id.includes("leads-"))
    return "ghl";
  return "none";
}

function calDuration(nodeId: string, stageId?: string | null): {
  durationDays: number;
  instant?: boolean;
  slaPhase?: number | null;
} {
  const entry = lookupCalendar(nodeId, stageId) as DwellCalendarEntry | null | undefined;
  if (!entry) return { durationDays: 0, instant: true, slaPhase: null };
  return {
    durationDays: entry.daysMin || 0,
    instant: entry.instant,
    slaPhase: entry.slaPhase ?? null,
  };
}

function nodeToWorkflow(n: Node): WorkflowNode {
  const kind =
    n.type === "zone"
      ? "zone"
      : n.type === "gridTie"
        ? "gridTie"
        : n.type === "pipeline"
          ? "pipeline"
          : n.type === "stage"
            ? "stage"
            : "system";

  const baseId = n.id!.includes("__") ? n.id!.split("__")[0]! : n.id!;
  const zoneId =
    kind === "zone"
      ? n.id!
      : kind === "gridTie"
        ? (n.data as GridTieNodeData).zoneId
        : zoneOfNode(baseId);

  const cal = calDuration(
    kind === "stage" ? (n.data as { parentPipelineId: string }).parentPipelineId : baseId,
    kind === "stage" ? (n.data as { stageId: string }).stageId : null
  );

  let label = n.id!;
  let subtitle: string | null = null;
  let icon: string | null = null;
  let accent: string | null = null;
  let stages: WorkflowNode["stages"];
  let stageId: string | null = null;
  let parentId: string | null = n.parentId ?? null;

  if (kind === "zone") {
    const d = n.data as ZoneNodeData;
    label = d.label;
    accent = d.accent;
  } else if (kind === "gridTie") {
    const d = n.data as GridTieNodeData;
    label = d.label;
    accent = d.accent;
  } else if (kind === "system") {
    const d = n.data as SystemNodeData;
    label = d.label;
    subtitle = d.subtitle ?? null;
    icon = d.icon ?? null;
    accent = d.accent;
  } else if (kind === "pipeline") {
    const d = n.data as PipelineNodeData;
    label = d.title;
    subtitle = d.subtitle ?? null;
    accent = d.accent;
    stages = d.stages?.map((s) => ({
      id: s.id,
      label: s.label,
      dimmed: s.dimmed,
      roleLabel: s.role?.label ?? null,
    }));
  } else if (kind === "stage") {
    const d = n.data as {
      label: string;
      stageId: string;
      parentPipelineId: string;
      accent: string;
    };
    label = d.label;
    stageId = d.stageId;
    parentId = d.parentPipelineId;
    accent = d.accent;
  }

  const styleW =
    typeof n.style?.width === "number"
      ? n.style.width
      : typeof n.style?.width === "string"
        ? Number.parseFloat(n.style.width)
        : null;
  const styleH =
    typeof n.style?.height === "number"
      ? n.style.height
      : typeof n.style?.height === "string"
        ? Number.parseFloat(n.style.height)
        : null;

  const payloadKeys =
    kind === "stage" ||
    baseId === "work-centers" ||
    baseId === "outsourced-accessories" ||
    baseId === "dispatch-routes" ||
    baseId === "delivery"
      ? [
          "puDrop",
          "metal",
          "powderCoatColor",
          "dektonSlabId",
          "fabricSku",
          "cushionCorte",
          "cushionSew",
          "cushionFill",
          "thirdPartyUmbrella",
          "thirdPartyFirepit",
          "thirdPartyTenjam",
        ]
      : undefined;

  return {
    id: n.id!,
    kind,
    zoneId,
    label,
    subtitle,
    icon,
    accent,
    parentId,
    stageId,
    stages,
    position: { x: n.position.x, y: n.position.y },
    width: (n.width as number | undefined) ?? styleW,
    height: (n.height as number | undefined) ?? styleH,
    zIndex: typeof n.style?.zIndex === "number" ? n.style.zIndex : null,
    durationDays: cal.durationDays,
    instant: cal.instant,
    slaPhase: cal.slaPhase,
    integration: inferIntegration(baseId),
    payloadKeys,
    rfType: n.type ?? "system",
    selectable: n.selectable,
    draggable: n.draggable,
    extent: n.extent === "parent" ? "parent" : null,
    style: (n.style as Record<string, unknown>) ?? null,
    dataExtra: (n.data as Record<string, unknown>) ?? null,
  };
}

function edgeToWorkflow(e: Edge): WorkflowEdge {
  const utility = classifyUtility(e.id, (e.data as { utility?: "digital" | "physical" | "financial" | "comms" })?.utility);
  const gridLevel = classifyGridLevel(
    e.id,
    e.source,
    e.target,
    (e.data as { gridLevel?: "trunk" | "branch" | "local" })?.gridLevel
  );
  const cable =
    (e.data as { cable?: boolean })?.cable ?? isDataCable(e.id);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    kind: cable ? "sync" : "flow",
    utility,
    gridLevel,
    cable,
    label: (e.data as { label?: string })?.label ?? null,
    brief: (e.data as { brief?: boolean })?.brief,
    lane: (e.data as { lane?: string })?.lane ?? null,
    hidden: e.hidden,
    zIndex: typeof e.zIndex === "number" ? e.zIndex : null,
  };
}

function stepToWorkflow(step: SequenceStep, index: number): WorkflowStep {
  const digitalTrigger = step.stageId
    ? `${step.nodeId}::${step.stageId}`
    : step.nodeId;
  const cal = calDuration(step.nodeId, step.stageId);
  return {
    stepIndex: index + 1,
    nodeId: step.nodeId,
    stageId: step.stageId ?? null,
    digitalTrigger,
    travelEdges: step.travelEdges ?? [],
    dwellMs: step.dwellMs ?? null,
    fanOutNodes: step.fanOutNodes,
    externalTrigger: step.externalTrigger
      ? {
          travelEdges: step.externalTrigger.travelEdges,
          targetNodeIds: step.externalTrigger.targetNodeIds,
          travelMs: step.externalTrigger.travelMs ?? null,
          holdMs: step.externalTrigger.holdMs ?? null,
        }
      : null,
    storyKey: step.storyKey ?? null,
    tone: step.tone ?? null,
    durationDays: cal.durationDays,
    inputsRequired: [],
    outputsGenerated: [],
  };
}

function buildWorkflows(): WorkflowDef[] {
  const out: WorkflowDef[] = [];
  const journeyIds = Object.keys(SEQUENCES) as JourneyId[];
  for (const journeyId of journeyIds) {
    const isEx = (EXCEPTION_JOURNEYS as string[]).includes(journeyId);
    out.push({
      id: `${journeyId}-full`,
      label: JOURNEY_LABELS[journeyId],
      journeyId,
      mode: "full",
      workflowType: isEx ? "exception" : "happy_path",
      steps: SEQUENCES[journeyId].map(stepToWorkflow),
    });
    out.push({
      id: `${journeyId}-board`,
      label: `${JOURNEY_LABELS[journeyId]} (Board)`,
      journeyId,
      mode: "board",
      workflowType: isEx ? "exception" : "happy_path",
      steps: BOARD_SEQUENCES[journeyId].map(stepToWorkflow),
    });
  }
  return out;
}

export function buildSeedFromLegacy(): MasterWorkflowSchema {
  const { nodes, edges } = buildGranularGraph(initialNodes, initialEdges);

  const zones = ZONE_LAYOUTS.map((z) => ({
    id: z.id,
    label: z.label,
    accent: z.accent,
    x: z.x,
    y: z.y,
    width: z.w,
    height: ZONE_H,
  }));

  /* Prefer measured zone dims from RF nodes */
  for (const n of nodes) {
    if (n.type !== "zone") continue;
    const z = zones.find((x) => x.id === n.id);
    if (!z) continue;
    z.x = n.position.x;
    z.y = n.position.y;
    if (typeof n.style?.width === "number") z.width = n.style.width;
    if (typeof n.style?.height === "number") z.height = n.style.height;
  }

  const workOrders: WorkOrderInstance[] = buildDemoWorkOrders();

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    sourceFiles: [
      "topologyData.ts",
      "sequences.ts",
      "dwellCalendar.ts",
      "zoneLayout.ts",
    ],
    zones,
    nodes: nodes.map(nodeToWorkflow),
    edges: edges.map(edgeToWorkflow),
    workflows: buildWorkflows(),
    workOrders,
  };
}
