"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getOutgoers, type Edge, type Node } from "@xyflow/react";
import {
  buildIntegrationDefaults,
  mergeIntegrationConfig,
  type NodeIntegrationConfig,
} from "../../schema/nodeIntegrationConfig";
import {
  type JourneyId,
  JOURNEY_COLORS,
  getActiveSequence,
} from "./sequences";
import type { RoleLens, ViewMode } from "./viewConfig";
import type { LayoutDirection, LayoutEngineId } from "./layoutEngine";
import {
  DEFAULT_JOURNEY_BUILDER,
  type JourneyBuilderConfig,
} from "./journeyBuilder";
import { granularNodeId, resolveStepFocusId } from "./granularGraph";
import type { SequenceStep } from "./sequences";
import type { WorkflowStep } from "../../schema/schemaTypes";
import {
  coerceOperationalNodeType,
  coerceOperationalZone,
  createEmptyOperationalTask,
  type OperationalTask,
  type OperationalZone,
} from "../../schema/operationalTask";
import {
  EXHAUSTIVE_OPERATIONAL_TASKS,
  EXHAUSTIVE_SEED_VERSION,
} from "../../schema/exhaustiveOperationalSeed";
import {
  operationalTasksToWorkflowSteps,
  workflowStepsToOperationalTasks,
} from "../control/operationalAdapters";
import { compileSequence } from "../../schema/compileSequence";
import { useSchemaStore } from "../../schema/schemaStore";
import type { FocusPresetId } from "./focusPresets";
import type { WalkthroughId } from "./ghlPipelines";
import { WALKTHROUGH_OPTIONS } from "./ghlPipelines";
import {
  inferProcessLinkKind,
  processLinkId,
  seedProcessLinks,
  PROCESS_MAP_REVISION,
  isMappableNodeId,
  sanitizeProcessLinks,
  sanitizeProcessLinkMap,
  type ProcessLink,
  type ProcessLinkKind,
} from "./processMap";

export type CanvasMode = "present" | "plan" | "engineer";
export type BlankSlotConfig = {
  zoneId: string;
  zone: OperationalZone;
};

function growTrail(existing: string[], incoming: Iterable<string>): string[] {
  return [...new Set([...existing, ...incoming])];
}

function spentTravel(s: {
  travelEdgeIds: string[];
  feederEdgeIds: string[];
}): string[] {
  return [...s.travelEdgeIds, ...s.feederEdgeIds];
}

export type PlaybackState = "idle" | "playing" | "paused";

export type TopologyStore = {
  viewMode: ViewMode;
  roleLens: RoleLens;
  showPlumbing: boolean;
  presenterMode: boolean;
  /** Drag + export layout for collision-free canvas tuning */
  layoutEditMode: boolean;
  operationalLayoutEngine: LayoutEngineId;
  operationalLayoutDirection: LayoutDirection;
  /** Present / Plan / Engineer shell */
  canvasMode: CanvasMode;
  focusPresetId: FocusPresetId;
  walkthroughId: WalkthroughId | null;
  heldTaskIds: string[];
  blankSlotConfigs: Record<string, BlankSlotConfig>;
  rightSidebarOpen: boolean;
  /** Canonical + user-edited process wires per walkthrough */
  processLinksByWalkthrough: Partial<Record<WalkthroughId, ProcessLink[]>>;
  processMapRevision: number;
  selectedMapNodeId: string | null;
  pendingMapLink: { nodeId: string; role: "input" | "output" } | null;

  movieMode: boolean;
  showJourneyBuilder: boolean;
  journeyBuilder: JourneyBuilderConfig;
  customSequence: SequenceStep[] | null;
  cameraFocusNodeId: string | null;

  // NEW: Command Center Blueprint State
  blueprint: WorkflowStep[];
  operationalTasks: OperationalTask[];
  selectedTaskId: string | null;
  isEditingDrawerOpen: boolean;
  selectedIntegrationNodeId: string | null;
  isIntegrationEditorOpen: boolean;
  nodeIntegrationConfigs: Record<string, NodeIntegrationConfig>;
  activeWorkflowNodeId: string | null;
  isSimulating: boolean;
  simulatedNodeId: string | null;
  simulationRunId: number;

  // NEW: Command Center Actions
  setBlueprint: (blueprint: WorkflowStep[]) => void;
  moveBlueprintTask: (oldIndex: number, newIndex: number) => void;
  setActiveWorkflowNodeId: (nodeId: string | null) => void;
  addTask: () => void;
  updateTask: (id: string, updatedData: Partial<OperationalTask>) => void;
  deleteTask: (id: string) => void;
  connectTasks: (sourceId: string, targetId: string) => void;
  disconnectTasks: (sourceId: string, targetId: string) => void;
  importTasks: (tasks: OperationalTask[]) => void;
  selectTask: (id: string | null) => void;
  closeInspector: () => void;
  openIntegrationEditor: (node: Node) => void;
  closeIntegrationEditor: () => void;
  updateNodeIntegration: (
    nodeId: string,
    patch: Partial<NodeIntegrationConfig>
  ) => void;
  runSimulation: () => void;

  playbackState: PlaybackState;
  journeyId: JourneyId;
  stepIndex: number;

  activeNodeId: string | null;
  activeStageId: string | null;
  secondaryNodeIds: string[];
  /** Buildings that stay lit until return-to-origin */
  latchedNodeIds: string[];
  /** Nested stage buttons that stay lit until return-to-origin */
  latchedStageIds: string[];
  /** Cities plugged in via Grid Tie */
  energizedZoneIds: string[];
  /** Origin trigger for the current cascade (return target) */
  originNodeId: string | null;
  originStageId: string | null;
  /** Synthetic Grid Tie → building feeder edges currently animating */
  feederEdgeIds: string[];
  /** Feeder edge objects for the canvas to mount during a cascade */
  pendingFeederEdges: Edge[];
  /** Red circuit wires currently reversing stroke-dashoffset */
  retractingEdgeIds: string[];
  /** Beam traveling back to origin */
  returnActive: boolean;
  travelEdgeIds: string[];
  /** Edges that stay solid-illuminated after travel (growing snake trail) */
  trailEdgeIds: string[];
  /** @deprecated Growing-snake model never dissolves; kept empty during a run */
  dissolvedEdgeIds: string[];
  /** Entire trail breathes after the last step completes */
  circuitComplete: boolean;
  pulseEdgeIds: string[];
  fadingNodeId: string | null;
  fadingStageId: string | null;
  /** Brief completion flash before fade */
  completingNodeId: string | null;
  completingStageId: string | null;
  completedNodeIds: string[];
  completedStageIds: string[];
  travelKey: number;
  /** Current beam animation duration (time-dilated) */
  activeTravelMs: number;
  /** Slow external handoff in progress */
  externalActive: boolean;
  activeStoryKey: string | null;
  stepTone: "happy" | "exception" | null;

  traceRootId: string | null;
  traceNodeIds: string[];
  traceEdgeIds: string[];

  graphNodes: Node[];
  graphEdges: Edge[];

  setViewMode: (m: ViewMode) => void;
  setRoleLens: (r: RoleLens) => void;
  setShowPlumbing: (v: boolean) => void;
  setPresenterMode: (v: boolean) => void;
  setLayoutEditMode: (v: boolean) => void;
  setOperationalLayoutEngine: (engine: LayoutEngineId) => void;
  setOperationalLayoutDirection: (direction: LayoutDirection) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  setFocusPresetId: (id: FocusPresetId) => void;
  setWalkthrough: (id: WalkthroughId | null) => void;
  processLinksForActive: () => ProcessLink[];
  addProcessLink: (
    source: string,
    target: string,
    kind?: ProcessLinkKind
  ) => void;
  removeProcessLink: (source: string, target: string) => void;
  resetProcessLinks: (id?: WalkthroughId | null) => void;
  selectMapNode: (id: string | null) => void;
  setPendingMapLink: (
    pending: { nodeId: string; role: "input" | "output" } | null
  ) => void;
  holdTask: (id: string) => void;
  restoreTask: (id: string) => void;
  plugBlankSlot: (zoneId: string, zone: OperationalZone, title?: string) => void;
  setRightSidebarOpen: (open: boolean) => void;
  applyTriggerToNode: (
    nodeId: string,
    patch: Partial<NodeIntegrationConfig>
  ) => void;
  setMovieMode: (v: boolean) => void;
  setShowJourneyBuilder: (v: boolean) => void;
  setJourneyBuilder: (c: JourneyBuilderConfig) => void;
  setCustomSequence: (steps: SequenceStep[] | null) => void;
  setCameraFocusNodeId: (id: string | null) => void;
  setJourney: (id: JourneyId) => void;
  setGraph: (nodes: Node[], edges: Edge[]) => void;
  setPlaybackState: (s: PlaybackState) => void;
  setStepIndex: (i: number) => void;

  beginTravel: (edgeIds: string[], travelMs?: number) => void;
  beginHold: (
    nodeId: string,
    stageId: string | undefined,
    fanOutNodes: string[],
    pulseEdgeIds: string[],
    storyKey?: string,
    tone?: "happy" | "exception"
  ) => void;
  beginExternalHold: (originNodeId: string, originStageId?: string) => void;
  /** Latch buildings/stages + energize their Grid Tie cities (persist until return) */
  latchCascade: (payload: {
    nodeIds: string[];
    stageIds?: string[];
    zoneIds: string[];
    feederEdgeIds?: string[];
    originNodeId?: string;
    originStageId?: string | null;
  }) => void;
  beginFeederTravel: (feederEdgeIds: string[], travelMs?: number) => void;
  beginReturnToOrigin: (edgeIds: string[], travelMs?: number) => void;
  beginCircuitGrow: (edgeIds: string[], travelMs?: number) => void;
  beginCircuitRetract: (edgeIds: string[], travelMs?: number) => void;
  clearCascadeLatches: () => void;
  beginComplete: (nodeId: string, stageId?: string) => void;
  beginFade: (nodeId: string, stageId?: string) => void;
  markCompleted: (nodeId: string, stageId?: string) => void;
  completeCircuit: () => void;
  clearCinematicVisuals: () => void;
  resetJourneyProgress: () => void;

  startTrace: (nodeId: string) => void;
  clearTrace: () => void;
  interruptPlaybackForTrace: () => void;

  journeyColor: () => string;
  sequenceLength: () => number;
};

function collectTransitiveDownstream(
  rootId: string,
  nodes: Node[],
  edges: Edge[]
): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = [rootId];
  const seen = new Set<string>([rootId]);

  while (queue.length) {
    const id = queue.shift()!;
    const node = nodes.find((n) => n.id === id);
    if (!node || node.type === "zone") continue;

    for (const e of edges) {
      if (e.source !== id || e.hidden) continue;
      edgeIds.add(e.id);
      if (!seen.has(e.target)) {
        seen.add(e.target);
        const t = nodes.find((n) => n.id === e.target);
        if (t && t.type !== "zone") {
          nodeIds.add(e.target);
          queue.push(e.target);
        }
      }
    }

    for (const o of getOutgoers(node, nodes, edges)) {
      if (o.type === "zone" || seen.has(o.id)) continue;
      seen.add(o.id);
      nodeIds.add(o.id);
      queue.push(o.id);
    }
  }

  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

export function immediateOutboundEdges(
  nodeId: string,
  edges: Edge[]
): string[] {
  return edges
    .filter((e) => e.source === nodeId && !e.hidden)
    .map((e) => e.id);
}

export function immediateOutgoerIds(
  nodeId: string,
  nodes: Node[],
  edges: Edge[]
): string[] {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  return getOutgoers(node, nodes, edges)
    .filter((n) => n.type !== "zone")
    .map((n) => n.id);
}

export const useTopologyStore = create<TopologyStore>()(
  persist(
    (set, get) => ({
  /** Default Full Map so growth/detail stays first-class */
  viewMode: "engineer",
  roleLens: "all",
  showPlumbing: false,
  presenterMode: true,
  layoutEditMode: false,
  operationalLayoutEngine: "humanCanvas",
  operationalLayoutDirection: "LR",
  canvasMode: "present",
  focusPresetId: "all",
  walkthroughId: null,
  heldTaskIds: [],
  blankSlotConfigs: {},
  rightSidebarOpen: false,
  processLinksByWalkthrough: {},
  processMapRevision: PROCESS_MAP_REVISION,
  selectedMapNodeId: null,
  pendingMapLink: null,

  movieMode: false,
  showJourneyBuilder: false,
  journeyBuilder: DEFAULT_JOURNEY_BUILDER,
  customSequence: null,
  cameraFocusNodeId: null,

  // NEW: Command Center Initial State
  blueprint: operationalTasksToWorkflowSteps(EXHAUSTIVE_OPERATIONAL_TASKS),
  operationalTasks: EXHAUSTIVE_OPERATIONAL_TASKS,
  selectedTaskId: null,
  isEditingDrawerOpen: false,
  selectedIntegrationNodeId: null,
  isIntegrationEditorOpen: false,
  nodeIntegrationConfigs: {},
  activeWorkflowNodeId: null,
  isSimulating: false,
  simulatedNodeId: null,
  simulationRunId: 0,

  // NEW: Command Center Actions
  setBlueprint: (blueprint) =>
    set({
      blueprint,
      operationalTasks: workflowStepsToOperationalTasks(blueprint),
    }),

  moveBlueprintTask: (oldIndex, newIndex) => {
    set((state) => {
      const tasks = [...state.operationalTasks];
      const [movedTask] = tasks.splice(oldIndex, 1);
      if (!movedTask) return state;
      tasks.splice(newIndex, 0, movedTask);
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
      };
    });
  },

  setActiveWorkflowNodeId: (nodeId) =>
    set({
      activeWorkflowNodeId: nodeId,
      selectedTaskId: nodeId,
      isEditingDrawerOpen: nodeId != null,
    }),

  addTask: () => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `task-${crypto.randomUUID()}`
        : `task-${Date.now()}`;
    const newTask = createEmptyOperationalTask(id);
    set((state) => {
      const tasks = [...state.operationalTasks, newTask];
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
        selectedTaskId: id,
        isEditingDrawerOpen: true,
        activeWorkflowNodeId: id,
      };
    });
  },

  updateTask: (id, updatedData) => {
    set((state) => {
      const tasks = state.operationalTasks.map((task) =>
        task.id === id ? { ...task, ...updatedData, id: task.id } : task
      );
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
      };
    });
  },

  connectTasks: (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    set((state) => {
      const ids = new Set(state.operationalTasks.map((task) => task.id));
      if (!ids.has(sourceId) || !ids.has(targetId)) return state;
      let changed = false;
      const tasks = state.operationalTasks.map((task) => {
        if (task.id !== targetId) return task;
        if (task.dependencies.includes(sourceId)) return task;
        changed = true;
        return { ...task, dependencies: [...task.dependencies, sourceId] };
      });
      if (!changed) return state;
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
      };
    });
  },

  disconnectTasks: (sourceId, targetId) => {
    if (!sourceId || !targetId) return;
    set((state) => {
      let changed = false;
      const tasks = state.operationalTasks.map((task) => {
        if (task.id !== targetId) return task;
        if (!task.dependencies.includes(sourceId)) return task;
        changed = true;
        return {
          ...task,
          dependencies: task.dependencies.filter((dep) => dep !== sourceId),
        };
      });
      if (!changed) return state;
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
      };
    });
  },

  deleteTask: (id) => {
    set((state) => {
      const tasks = state.operationalTasks
        .filter((task) => task.id !== id)
        .map((task) => ({
          ...task,
          dependencies: task.dependencies.filter((dep) => dep !== id),
        }));
      const closing = state.selectedTaskId === id;
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
        selectedTaskId: closing ? null : state.selectedTaskId,
        isEditingDrawerOpen: closing ? false : state.isEditingDrawerOpen,
        activeWorkflowNodeId: closing ? null : state.activeWorkflowNodeId,
      };
    });
  },

  importTasks: (tasks) =>
    set({
      operationalTasks: tasks,
      blueprint: operationalTasksToWorkflowSteps(tasks),
      selectedTaskId: null,
      isEditingDrawerOpen: false,
      activeWorkflowNodeId: null,
    }),

  selectTask: (id) =>
    set({
      selectedTaskId: id,
      isEditingDrawerOpen: id != null,
      activeWorkflowNodeId: id,
      isIntegrationEditorOpen: false,
      selectedIntegrationNodeId: null,
    }),

  closeInspector: () =>
    set({
      selectedTaskId: null,
      isEditingDrawerOpen: false,
      activeWorkflowNodeId: null,
    }),

  openIntegrationEditor: (node) => {
    if (node.type === "zone") return;
    const defaults = buildIntegrationDefaults(node);
    const existing = get().nodeIntegrationConfigs[node.id];
    const merged = mergeIntegrationConfig(existing, defaults);
    set({
      selectedIntegrationNodeId: node.id,
      isIntegrationEditorOpen: true,
      isEditingDrawerOpen: false,
      selectedTaskId: null,
      activeWorkflowNodeId: null,
      nodeIntegrationConfigs: {
        ...get().nodeIntegrationConfigs,
        [node.id]: merged,
      },
    });
  },

  closeIntegrationEditor: () =>
    set({
      selectedIntegrationNodeId: null,
      isIntegrationEditorOpen: false,
    }),

  updateNodeIntegration: (nodeId, patch) =>
    set((state) => {
      const current =
        state.nodeIntegrationConfigs[nodeId] ??
        buildIntegrationDefaults({
          id: nodeId,
          type: "system",
          position: { x: 0, y: 0 },
          data: { label: nodeId, accent: "#64748b" },
        });
      return {
        nodeIntegrationConfigs: {
          ...state.nodeIntegrationConfigs,
          [nodeId]: { ...current, ...patch },
        },
      };
    }),

  runSimulation: () => {
    const { blueprint, isSimulating } = get();
    if (isSimulating || blueprint.length === 0) return;

    const runId = get().simulationRunId + 1;
    set({
      isSimulating: true,
      simulationRunId: runId,
      simulatedNodeId: null,
    });

    void (async () => {
      for (const step of blueprint) {
        if (get().simulationRunId !== runId) return;
        set({
          simulatedNodeId: granularNodeId(step.nodeId, step.stageId),
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (get().simulationRunId === runId) {
        set({ isSimulating: false, simulatedNodeId: null });
      }
    })();
  },

  playbackState: "idle",
  journeyId: "retail",
  stepIndex: 0,

  activeNodeId: null,
  activeStageId: null,
  secondaryNodeIds: [],
  latchedNodeIds: [],
  latchedStageIds: [],
  energizedZoneIds: [],
  originNodeId: null,
  originStageId: null,
  feederEdgeIds: [],
  pendingFeederEdges: [],
  retractingEdgeIds: [],
  returnActive: false,
  travelEdgeIds: [],
  trailEdgeIds: [],
  dissolvedEdgeIds: [],
  circuitComplete: false,
  pulseEdgeIds: [],
  fadingNodeId: null,
  fadingStageId: null,
  completingNodeId: null,
  completingStageId: null,
  completedNodeIds: [],
  completedStageIds: [],
  travelKey: 0,
  activeTravelMs: 2200,
  externalActive: false,
  activeStoryKey: null,
  stepTone: null,

  traceRootId: null,
  traceNodeIds: [],
  traceEdgeIds: [],

  graphNodes: [],
  graphEdges: [],

  setViewMode: (m) =>
    set({
      viewMode: m,
      stepIndex: 0,
      trailEdgeIds: [],
      dissolvedEdgeIds: [],
      circuitComplete: false,
      completedNodeIds: [],
      completedStageIds: [],
      playbackState: "idle",
    }),
  setRoleLens: (r) => set({ roleLens: r }),
  setShowPlumbing: (v) => set({ showPlumbing: v }),
  setPresenterMode: (v) => set({ presenterMode: v }),
  setLayoutEditMode: (v) => set({ layoutEditMode: v }),
  setOperationalLayoutEngine: (engine) =>
    set({ operationalLayoutEngine: engine }),
  setOperationalLayoutDirection: (direction) =>
    set({ operationalLayoutDirection: direction }),
  setCanvasMode: (mode) =>
    set((state) => {
      const next: Partial<TopologyStore> = {
        canvasMode: mode,
        presenterMode: mode === "present",
        rightSidebarOpen: mode === "plan",
      };
      if (mode === "present" || mode === "plan") {
        next.operationalLayoutEngine = "humanCanvas";
        next.layoutEditMode = false;
      } else if (mode === "engineer" && state.operationalLayoutEngine === "humanCanvas") {
        next.operationalLayoutEngine = "grid";
      }
      return next;
    }),
  setFocusPresetId: (id) => set({ focusPresetId: id }),
  setWalkthrough: (id) => {
    if (id == null) {
      set({
        walkthroughId: null,
        stepIndex: 0,
        playbackState: "idle",
        trailEdgeIds: [],
        completedNodeIds: [],
        completedStageIds: [],
        circuitComplete: false,
        selectedMapNodeId: null,
        pendingMapLink: null,
      });
      return;
    }
    const opt = WALKTHROUGH_OPTIONS.find((o) => o.id === id);
    set((state) => ({
      walkthroughId: id,
      journeyId: opt?.journeyId ?? "retail",
      stepIndex: 0,
      playbackState: "idle",
      trailEdgeIds: [],
      completedNodeIds: [],
      completedStageIds: [],
      circuitComplete: false,
      selectedMapNodeId: null,
      pendingMapLink: null,
      processLinksByWalkthrough: state.processLinksByWalkthrough[id]
        ? state.processLinksByWalkthrough
        : {
            ...state.processLinksByWalkthrough,
            [id]: seedProcessLinks(id),
          },
    }));
  },
  processLinksForActive: () => {
    const { walkthroughId, processLinksByWalkthrough } = get();
    if (!walkthroughId) return [];
    return (
      sanitizeProcessLinks(processLinksByWalkthrough[walkthroughId]) ??
      seedProcessLinks(walkthroughId)
    );
  },
  addProcessLink: (source, target, kind) => {
    if (!source || !target || source === target) return;
    if (!isMappableNodeId(source) || !isMappableNodeId(target)) return;
    const wt = get().walkthroughId;
    if (!wt) return;
    const inferred = kind ?? inferProcessLinkKind(source, target);
    const id = processLinkId(source, target, inferred);
    set((state) => {
      const current =
        sanitizeProcessLinks(state.processLinksByWalkthrough[wt]) ??
        seedProcessLinks(wt);
      if (current.some((l) => l.source === source && l.target === target)) {
        return state;
      }
      return {
        processLinksByWalkthrough: {
          ...state.processLinksByWalkthrough,
          [wt]: [...current, { id, source, target, kind: inferred }],
        },
      };
    });
  },
  removeProcessLink: (source, target) => {
    const wt = get().walkthroughId;
    if (!wt) return;
    set((state) => {
      const current = sanitizeProcessLinks(
        state.processLinksByWalkthrough[wt]
      );
      if (!current) return state;
      return {
        processLinksByWalkthrough: {
          ...state.processLinksByWalkthrough,
          [wt]: current.filter(
            (l) => !(l.source === source && l.target === target)
          ),
        },
      };
    });
  },
  resetProcessLinks: (id) => {
    const wt = id ?? get().walkthroughId;
    if (!wt) return;
    set((state) => ({
      processLinksByWalkthrough: {
        ...state.processLinksByWalkthrough,
        [wt]: seedProcessLinks(wt),
      },
    }));
  },
  selectMapNode: (id) =>
    set({
      selectedMapNodeId: id,
      pendingMapLink: null,
    }),
  setPendingMapLink: (pending) => set({ pendingMapLink: pending }),
  holdTask: (id) =>
    set((state) => {
      if (state.heldTaskIds.includes(id)) return state;
      return { heldTaskIds: [...state.heldTaskIds, id] };
    }),
  restoreTask: (id) =>
    set((state) => ({
      heldTaskIds: state.heldTaskIds.filter((taskId) => taskId !== id),
    })),
  plugBlankSlot: (zoneId, zone, title) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `task-${crypto.randomUUID()}`
        : `task-${Date.now()}`;
    const newTask = createEmptyOperationalTask(id, {
      title: title?.trim() || "New process step",
      zone,
      duration: "1d",
    });
    set((state) => {
      const tasks = [...state.operationalTasks, newTask];
      return {
        operationalTasks: tasks,
        blueprint: operationalTasksToWorkflowSteps(tasks),
        selectedTaskId: id,
        isEditingDrawerOpen: false,
        selectedIntegrationNodeId: id,
        isIntegrationEditorOpen: true,
        blankSlotConfigs: {
          ...state.blankSlotConfigs,
          [zoneId]: { zoneId, zone },
        },
      };
    });
  },
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  applyTriggerToNode: (nodeId, patch) => {
    const defaults = buildIntegrationDefaults({
      id: nodeId,
      type: "system",
      position: { x: 0, y: 0 },
      data: { label: nodeId, accent: "#64748b" },
    });
    const existing = get().nodeIntegrationConfigs[nodeId];
    const merged = { ...mergeIntegrationConfig(existing, defaults), ...patch };
    set({
      nodeIntegrationConfigs: {
        ...get().nodeIntegrationConfigs,
        [nodeId]: merged,
      },
      selectedIntegrationNodeId: nodeId,
      isIntegrationEditorOpen: true,
    });
  },
  setMovieMode: (v) =>
    set({
      movieMode: v,
      cameraFocusNodeId: v ? get().cameraFocusNodeId : null,
    }),
  setShowJourneyBuilder: (v) => set({ showJourneyBuilder: v }),
  setJourneyBuilder: (c) => set({ journeyBuilder: c }),
  setCustomSequence: (steps) => set({ customSequence: steps }),
  setCameraFocusNodeId: (id) => set({ cameraFocusNodeId: id }),
  setJourney: (id) =>
    set({
      journeyId: id,
      stepIndex: 0,
      trailEdgeIds: [],
      dissolvedEdgeIds: [],
      circuitComplete: false,
      completedNodeIds: [],
      completedStageIds: [],
    }),
  setGraph: (nodes, edges) => set({ graphNodes: nodes, graphEdges: edges }),
  setPlaybackState: (s) => set({ playbackState: s }),
  setStepIndex: (i) => set({ stepIndex: i }),

  beginTravel: (edgeIds, travelMs) =>
    set((s) => ({
      trailEdgeIds: growTrail(
        s.trailEdgeIds,
        [...spentTravel(s), ...edgeIds].filter((id) => !id.startsWith("ping-"))
      ),
      dissolvedEdgeIds: [],
      travelEdgeIds: edgeIds,
      retractingEdgeIds: [],
      travelKey: s.travelKey + 1,
      activeTravelMs: travelMs ?? s.activeTravelMs,
      activeNodeId: null,
      activeStageId: null,
      secondaryNodeIds: s.latchedNodeIds,
      pulseEdgeIds: [],
      fadingNodeId: null,
      fadingStageId: null,
      completingNodeId: null,
      completingStageId: null,
      externalActive: false,
      returnActive: false,
      activeStoryKey: null,
      stepTone: null,
      cameraFocusNodeId: null,
    })),

  beginHold: (nodeId, stageId, fanOutNodes, pulseEdgeIds, storyKey, tone) =>
    set((s) => {
      const latchExtra = fanOutNodes.filter((id) => id !== nodeId);
      return {
        trailEdgeIds: growTrail(s.trailEdgeIds, spentTravel(s)),
        dissolvedEdgeIds: [],
        travelEdgeIds: [],
        returnActive: false,
        activeNodeId: nodeId,
        activeStageId: stageId ?? null,
        secondaryNodeIds: [
          ...new Set([...s.latchedNodeIds, ...latchExtra].filter((id) => id !== nodeId)),
        ],
        latchedNodeIds: [
          ...new Set([...s.latchedNodeIds, nodeId, ...latchExtra]),
        ],
        latchedStageIds: stageId
          ? [...new Set([...s.latchedStageIds, stageId])]
          : s.latchedStageIds,
        pulseEdgeIds,
        fadingNodeId: null,
        fadingStageId: null,
        completingNodeId: null,
        completingStageId: null,
        externalActive: false,
        activeStoryKey: storyKey ?? null,
        stepTone: tone ?? "happy",
        cameraFocusNodeId: resolveStepFocusId(nodeId, stageId),
        originNodeId: s.originNodeId ?? nodeId,
        originStageId:
          s.originStageId ?? (stageId !== undefined ? stageId : null),
      };
    }),

  beginExternalHold: (originNodeId, originStageId) =>
    set({
      externalActive: true,
      activeNodeId: originNodeId,
      activeStageId: originStageId ?? null,
      cameraFocusNodeId: resolveStepFocusId(originNodeId, originStageId),
    }),

  latchCascade: ({
    nodeIds,
    stageIds,
    zoneIds,
    feederEdgeIds,
    originNodeId,
    originStageId,
  }) =>
    set((s) => ({
      latchedNodeIds: [...new Set([...s.latchedNodeIds, ...nodeIds])],
      latchedStageIds: stageIds
        ? [...new Set([...s.latchedStageIds, ...stageIds])]
        : s.latchedStageIds,
      energizedZoneIds: [...new Set([...s.energizedZoneIds, ...zoneIds])],
      feederEdgeIds: feederEdgeIds
        ? [...new Set([...s.feederEdgeIds, ...feederEdgeIds])]
        : s.feederEdgeIds,
      secondaryNodeIds: [
        ...new Set([
          ...s.secondaryNodeIds,
          ...s.latchedNodeIds,
          ...nodeIds,
        ]),
      ],
      originNodeId: originNodeId ?? s.originNodeId,
      originStageId:
        originStageId !== undefined ? originStageId : s.originStageId,
    })),

  beginFeederTravel: (feederEdgeIds, travelMs) =>
    set((s) => ({
      trailEdgeIds: growTrail(s.trailEdgeIds, [
        ...spentTravel(s),
        ...feederEdgeIds,
      ]),
      dissolvedEdgeIds: [],
      feederEdgeIds,
      travelEdgeIds: feederEdgeIds,
      travelKey: s.travelKey + 1,
      activeTravelMs: travelMs ?? 900,
      returnActive: false,
    })),

  beginReturnToOrigin: (edgeIds, travelMs) =>
    set((s) => ({
      trailEdgeIds: growTrail(
        s.trailEdgeIds,
        [...spentTravel(s), ...edgeIds].filter((id) => !id.startsWith("ping-"))
      ),
      dissolvedEdgeIds: [],
      travelEdgeIds: edgeIds,
      travelKey: s.travelKey + 1,
      activeTravelMs: travelMs ?? 1400,
      returnActive: true,
      retractingEdgeIds: [],
      externalActive: false,
      completingNodeId: null,
      completingStageId: null,
      secondaryNodeIds: s.latchedNodeIds.filter((id) => id !== s.originNodeId),
      activeNodeId: s.originNodeId,
      activeStageId: s.originStageId,
      cameraFocusNodeId: s.originNodeId
        ? resolveStepFocusId(s.originNodeId, s.originStageId)
        : null,
    })),

  beginCircuitGrow: (edgeIds, travelMs) =>
    set((s) => ({
      travelEdgeIds: edgeIds,
      retractingEdgeIds: [],
      travelKey: s.travelKey + 1,
      activeTravelMs: travelMs ?? 900,
      returnActive: false,
      feederEdgeIds: [...new Set([...s.feederEdgeIds, ...edgeIds])],
    })),

  beginCircuitRetract: (edgeIds, travelMs) =>
    set((s) => ({
      retractingEdgeIds: edgeIds,
      travelEdgeIds: edgeIds,
      travelKey: s.travelKey + 1,
      activeTravelMs: travelMs ?? 900,
      returnActive: false,
    })),

  clearCascadeLatches: () =>
    set({
      latchedNodeIds: [],
      latchedStageIds: [],
      energizedZoneIds: [],
      feederEdgeIds: [],
      pendingFeederEdges: [],
      retractingEdgeIds: [],
      returnActive: false,
      originNodeId: null,
      originStageId: null,
    }),

  beginComplete: (nodeId, stageId) =>
    set((s) => ({
      trailEdgeIds: growTrail(s.trailEdgeIds, spentTravel(s)),
      dissolvedEdgeIds: [],
      completingNodeId: nodeId,
      completingStageId: stageId ?? null,
      travelEdgeIds: [],
      feederEdgeIds: [],
      pulseEdgeIds: [],
      externalActive: false,
      returnActive: false,
      retractingEdgeIds: [],
      cameraFocusNodeId: resolveStepFocusId(nodeId, stageId),
    })),

  beginFade: (nodeId, stageId) =>
    set({
      activeNodeId: null,
      activeStageId: null,
      secondaryNodeIds: [],
      pulseEdgeIds: [],
      completingNodeId: null,
      completingStageId: null,
      fadingNodeId: nodeId,
      fadingStageId: stageId ?? null,
      externalActive: false,
      returnActive: false,
      retractingEdgeIds: [],
      cameraFocusNodeId: null,
    }),

  markCompleted: (nodeId, stageId) =>
    set((s) => ({
      completedNodeIds: s.completedNodeIds.includes(nodeId)
        ? s.completedNodeIds
        : [...s.completedNodeIds, nodeId],
      completedStageIds: stageId
        ? s.completedStageIds.includes(stageId)
          ? s.completedStageIds
          : [...s.completedStageIds, stageId]
        : s.completedStageIds,
      fadingNodeId: null,
      fadingStageId: null,
    })),

  completeCircuit: () =>
    set((s) => ({
      circuitComplete: s.trailEdgeIds.length > 0,
      playbackState: "idle",
    })),

  clearCinematicVisuals: () =>
    set({
      activeNodeId: null,
      activeStageId: null,
      secondaryNodeIds: [],
      latchedNodeIds: [],
      latchedStageIds: [],
      energizedZoneIds: [],
      originNodeId: null,
      originStageId: null,
      feederEdgeIds: [],
      pendingFeederEdges: [],
      retractingEdgeIds: [],
      returnActive: false,
      travelEdgeIds: [],
      pulseEdgeIds: [],
      fadingNodeId: null,
      fadingStageId: null,
      completingNodeId: null,
      completingStageId: null,
      externalActive: false,
      activeStoryKey: null,
      stepTone: null,
      cameraFocusNodeId: null,
    }),

  resetJourneyProgress: () =>
    set({
      trailEdgeIds: [],
      dissolvedEdgeIds: [],
      circuitComplete: false,
      completedNodeIds: [],
      completedStageIds: [],
      latchedNodeIds: [],
      latchedStageIds: [],
      energizedZoneIds: [],
      feederEdgeIds: [],
      pendingFeederEdges: [],
      retractingEdgeIds: [],
      returnActive: false,
      originNodeId: null,
      originStageId: null,
      stepIndex: 0,
    }),

  interruptPlaybackForTrace: () =>
    set({
      playbackState: "idle",
      activeNodeId: null,
      activeStageId: null,
      secondaryNodeIds: [],
      latchedNodeIds: [],
      latchedStageIds: [],
      energizedZoneIds: [],
      originNodeId: null,
      originStageId: null,
      feederEdgeIds: [],
      pendingFeederEdges: [],
      retractingEdgeIds: [],
      returnActive: false,
      travelEdgeIds: [],
      pulseEdgeIds: [],
      fadingNodeId: null,
      fadingStageId: null,
      completingNodeId: null,
      completingStageId: null,
      externalActive: false,
      activeStoryKey: null,
      stepTone: null,
    }),

  startTrace: (nodeId) => {
    const { graphNodes, graphEdges } = get();
    get().interruptPlaybackForTrace();
    const { nodeIds, edgeIds } = collectTransitiveDownstream(
      nodeId,
      graphNodes,
      graphEdges
    );
    set({
      traceRootId: nodeId,
      traceNodeIds: nodeIds,
      traceEdgeIds: edgeIds,
    });
  },

  clearTrace: () =>
    set({
      traceRootId: null,
      traceNodeIds: [],
      traceEdgeIds: [],
    }),

  journeyColor: () => JOURNEY_COLORS[get().journeyId],
  sequenceLength: () => {
    const { journeyId, viewMode, customSequence, movieMode } = get();
    if (movieMode && customSequence?.length) return customSequence.length;
    const mode = viewMode === "board" ? "board" : "full";
    const projected = compileSequence(
      useSchemaStore.getState().schema,
      journeyId,
      mode
    );
    if (projected.length) return projected.length;
    return getActiveSequence(journeyId, mode).length;
  },
    }),
    {
      name: "ccpatio-operations-blueprint",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return localStorage;
      }),
      version: EXHAUSTIVE_SEED_VERSION,
      partialize: (state) => ({
        operationalTasks: state.operationalTasks,
        nodeIntegrationConfigs: state.nodeIntegrationConfigs,
        heldTaskIds: state.heldTaskIds,
        canvasMode: state.canvasMode,
        focusPresetId: state.focusPresetId,
        operationalLayoutEngine: state.operationalLayoutEngine,
        processLinksByWalkthrough: state.processLinksByWalkthrough,
        processMapRevision: state.processMapRevision,
      }),
      migrate: (persistedState, version) => {
        if (version < EXHAUSTIVE_SEED_VERSION) {
          return { operationalTasks: EXHAUSTIVE_OPERATIONAL_TASKS };
        }
        return persistedState as Partial<Pick<TopologyStore, "operationalTasks">>;
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<
          Pick<
            TopologyStore,
            | "operationalTasks"
            | "nodeIntegrationConfigs"
            | "heldTaskIds"
            | "canvasMode"
            | "focusPresetId"
            | "operationalLayoutEngine"
            | "processLinksByWalkthrough"
            | "processMapRevision"
          >
        >;
        const raw = persisted.operationalTasks ?? currentState.operationalTasks;
        const source =
          raw.length >= 96 ? raw : EXHAUSTIVE_OPERATIONAL_TASKS;
        const tasks = source.map((task) => ({
          ...task,
          zone: coerceOperationalZone(task.zone),
          nodeType: coerceOperationalNodeType(task.nodeType),
        }));
        const canvasMode = persisted.canvasMode ?? currentState.canvasMode;
        return {
          ...currentState,
          operationalTasks: tasks,
          blueprint: operationalTasksToWorkflowSteps(tasks),
          nodeIntegrationConfigs:
            persisted.nodeIntegrationConfigs ??
            currentState.nodeIntegrationConfigs,
          heldTaskIds: persisted.heldTaskIds ?? currentState.heldTaskIds,
          canvasMode,
          focusPresetId: persisted.focusPresetId ?? currentState.focusPresetId,
          operationalLayoutEngine:
            persisted.operationalLayoutEngine ??
            (canvasMode === "engineer" ? "grid" : "humanCanvas"),
          processLinksByWalkthrough:
            persisted.processMapRevision === PROCESS_MAP_REVISION
              ? sanitizeProcessLinkMap(
                  persisted.processLinksByWalkthrough ??
                    currentState.processLinksByWalkthrough
                )
              : {},
          processMapRevision: PROCESS_MAP_REVISION,
          presenterMode: canvasMode === "present",
          rightSidebarOpen: canvasMode === "plan",
        };
      },
    }
  )
);
