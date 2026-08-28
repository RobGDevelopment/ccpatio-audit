"use client";

import { useCallback, useEffect, useMemo, useState, useRef, type MouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ConnectionMode,
  ReactFlowProvider,
  type NodeTypes,
  type EdgeTypes,
  type DefaultEdgeOptions,
  useEdgesState,
  useNodesState,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type OnBeforeDelete,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "framer-motion";

import { BeamEdge, BeamDefs } from "./BeamEdge";
import { TrunkBusEdge } from "./TrunkBusEdge";
import { PingEdge } from "./PingEdge";
import {
  SystemNode,
  ZoneNode,
  PipelineNode,
  StageNode,
  GatewayNode,
  MilestoneNode,
  GridTieNode,
  SocketNode,
  BlankSlotNode,
  RailCardNode,
} from "./nodes";
import { lifecycleNodes, lifecycleEdges } from "./lifecycleTopologyData";
import { useTopologyStore } from "./topologyStore";
import { useSequenceController } from "./useSequenceController";
import { JOURNEY_COLORS, type SequenceStep } from "./sequences";
import { StoryCardPanel } from "./StoryCardPanel";
import { MovieCamera } from "./MovieCamera";
import { CalendarStrip } from "./CalendarStrip";
import { JourneyBuilderOverlay } from "./JourneyBuilderOverlay";
import { ConnectionMapPanel } from "./ConnectionMapPanel";
import { RoadmapIdleSplash } from "./RoadmapIdleSplash";
import {
  isEditableProcessEdgeId,
  isMappableNodeId,
  sanitizeProcessLinks,
  buildPlaybackStepsFromProcessMap,
} from "./processMap";
import { DashboardHeader } from "./DashboardHeader";
import { ScenarioSelectorModal } from "./ScenarioSelectorModal";
import {
  buildScenarioSequenceSteps,
  type LeadScenarioId,
} from "./topology-scenarios";
import {
  collectScenarioVisibleEdgeIds,
  muteEdgesForCanvas,
} from "./scenarioEdgePolicy";
import { buildCustomSequence } from "./journeyBuilder";
import {
  saveLayout,
} from "./layoutStudio";
import { buildBlueprintLayoutGraph, layoutOperationalTasks } from "./layoutEngine";
import { buildLifecycleSnakeSequence } from "./humanCanvasLayout";
import { FOCUS_PRESETS } from "./focusPresets";
import { InspectorDrawer } from "../control/InspectorDrawer";
import { IntegrationEditorPanel } from "../control/IntegrationEditorPanel";
import { RightSidebar } from "../control/RightSidebar";
import { useSchemaStore } from "../../schema/schemaStore";
import { compileTopology } from "../../schema/compileTopology";
import { GanttControlPlane } from "../gantt/GanttControlPlane";
import { compileSequence } from "../../schema/compileSequence";
import { validateBlueprint } from "../control/DependencyValidator";

const nodeTypes: NodeTypes = {
  system: SystemNode,
  zone: ZoneNode,
  pipeline: PipelineNode,
  stage: StageNode,
  gateway: GatewayNode,
  milestone: MilestoneNode,
  gridTie: GridTieNode,
  socket: SocketNode,
  blankSlot: BlankSlotNode,
  railCard: RailCardNode,
};

const edgeTypes: EdgeTypes = {
  beam: BeamEdge,
  trunkBus: TrunkBusEdge,
  ping: PingEdge,
};

function MovieModeBar({
  steps,
  seqLen,
  progress,
  color,
  onPause,
  onExit,
}: {
  steps: SequenceStep[];
  seqLen: number;
  progress: number;
  color: string;
  onPause: () => void;
  onExit: () => void;
}) {
  const playbackState = useTopologyStore((s) => s.playbackState);
  const stepIndex = useTopologyStore((s) => s.stepIndex);
  const statusLabel =
    playbackState === "playing"
      ? "Playing"
      : playbackState === "paused"
        ? "Paused"
        : "Idle";

  return (
    <header className="pointer-events-auto z-30 flex shrink-0 items-center justify-between gap-4 border-b border-cyan-500/20 bg-slate-950/95 px-4 py-2 backdrop-blur-md">
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-cyan-400">
          Movie Mode
        </div>
        <div className="text-xs text-slate-400">
          Executive presentation · Esc to exit
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {statusLabel}
        </span>
        <CalendarStrip steps={steps} stepIndex={stepIndex} color={color} compact />
        <span
          className="font-[family-name:var(--font-plex-mono)] text-[10px] tabular-nums"
          style={{ color }}
        >
          {stepIndex + 1}/{seqLen}
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.35 }}
          />
        </div>
        <button
          type="button"
          onClick={onPause}
          disabled={playbackState !== "playing" && playbackState !== "paused"}
          className="rounded-lg border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
        >
          {playbackState === "paused" ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg border border-slate-600 px-2.5 py-1 text-[11px] text-slate-400"
        >
          Exit
        </button>
      </div>
    </header>
  );
}

function TopologyCanvas() {
  const [mounted, setMounted] = useState(false);
  const isHydrated = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(lifecycleNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(lifecycleEdges);
  const { pause, stepNext, playMovie, exitMovie, resetPlayback, playLeadScenario } =
    useSequenceController();

  const playbackState = useTopologyStore((s) => s.playbackState);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const stepIndex = useTopologyStore((s) => s.stepIndex);
  const viewMode = useTopologyStore((s) => s.viewMode);
  const movieMode = useTopologyStore((s) => s.movieMode);
  const layoutEditMode = useTopologyStore((s) => s.layoutEditMode);
  const showJourneyBuilder = useTopologyStore((s) => s.showJourneyBuilder);
  const journeyBuilder = useTopologyStore((s) => s.journeyBuilder);
  const customSequence = useTopologyStore((s) => s.customSequence);
  const pendingFeederEdges = useTopologyStore((s) => s.pendingFeederEdges);
  const setShowJourneyBuilder = useTopologyStore((s) => s.setShowJourneyBuilder);
  const setGraph = useTopologyStore((s) => s.setGraph);
  const clearTrace = useTopologyStore((s) => s.clearTrace);
  const controlPlaneView = useSchemaStore((s) => s.controlPlaneView);
  const schema = useSchemaStore((s) => s.schema);
  const schemaRevision = useSchemaStore((s) => s.revision);
  const color = JOURNEY_COLORS[journeyId];
  const blueprint = useTopologyStore((s) => s.blueprint);
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const focusPresetId = useTopologyStore((s) => s.focusPresetId);
  const walkthroughId = useTopologyStore((s) => s.walkthroughId);
  const leadScenarioId = useTopologyStore((s) => s.leadScenarioId);
  const scenarioModalOpen = useTopologyStore((s) => s.scenarioModalOpen);
  const setScenarioModalOpen = useTopologyStore((s) => s.setScenarioModalOpen);
  const canvasEdgesMuted = useTopologyStore((s) => s.canvasEdgesMuted);
  const setCanvasEdgesMuted = useTopologyStore((s) => s.setCanvasEdgesMuted);
  const travelEdgeIds = useTopologyStore((s) => s.travelEdgeIds);
  const trailEdgeIds = useTopologyStore((s) => s.trailEdgeIds);
  const feederEdgeIds = useTopologyStore((s) => s.feederEdgeIds);
  const retractingEdgeIds = useTopologyStore((s) => s.retractingEdgeIds);
  const graphNodes = useTopologyStore((s) => s.graphNodes);
  const processLinksByWalkthrough = useTopologyStore(
    (s) => s.processLinksByWalkthrough
  );
  const storedProcessLinks = walkthroughId
    ? processLinksByWalkthrough[walkthroughId]
    : undefined;
  const processLinks = useMemo(
    () =>
      storedProcessLinks
        ? (sanitizeProcessLinks(storedProcessLinks) ?? storedProcessLinks)
        : undefined,
    [storedProcessLinks]
  );
  const operationalSequence = useMemo(
    () =>
      operationalTasks.length > 0 && walkthroughId
        ? buildPlaybackStepsFromProcessMap(
            walkthroughId,
            processLinks ?? [],
            new Set(
              operationalTasks
                .map((t) => t.id)
                .concat(
                  (processLinks ?? []).flatMap((l) => [l.source, l.target])
                )
            )
          )
        : operationalTasks.length > 0
          ? buildLifecycleSnakeSequence(
              operationalTasks,
              walkthroughId ?? "scottsdale"
            )
          : [],
    [operationalTasks, walkthroughId, processLinks]
  );
  const steps = useMemo(() => {
    const base =
      movieMode && customSequence?.length
        ? customSequence
        : operationalSequence.length > 0 && !movieMode
          ? operationalSequence
          : compileSequence(
              schema,
              journeyId,
              viewMode === "board" ? "board" : "full"
            );
    const playIds = FOCUS_PRESETS[focusPresetId]?.playTaskIds ?? [];
    if (playIds.length === 0) return base;
    const allow = new Set(playIds);
    const filtered = base.filter((step) => allow.has(step.nodeId));
    return filtered.length > 0 ? filtered : base;
  }, [
    movieMode,
    customSequence,
    operationalSequence,
    schema,
    journeyId,
    viewMode,
    focusPresetId,
  ]);
  const seqLen = useMemo(() => {
    if (leadScenarioId) {
      const mounted = new Set(graphNodes.map((n) => n.id));
      return buildScenarioSequenceSteps(leadScenarioId, mounted).length;
    }
    return steps.length;
  }, [leadScenarioId, graphNodes, steps]);
  const operationalLayoutEngine = useTopologyStore((s) => s.operationalLayoutEngine);
  const operationalLayoutDirection = useTopologyStore(
    (s) => s.operationalLayoutDirection
  );
  const heldTaskIds = useTopologyStore((s) => s.heldTaskIds);
  const simulatedNodeId = useTopologyStore((s) => s.simulatedNodeId);
  const invalidNodeIds = useMemo(() => new Set(validateBlueprint(blueprint)), [blueprint]);

  const operationalLayoutKey = useMemo(
    () =>
      operationalTasks
        .map(
          (task) =>
            `${task.id}:${task.title}:${task.zone}:${task.duration}:${task.dependencies.join(",")}`
        )
        .join("|") + `|held:${heldTaskIds.join(",")}`,
    [operationalTasks, heldTaskIds]
  );

  const blueprintLayoutKey = useMemo(
    () =>
      blueprint
        .map((s) => `${s.stepIndex}:${s.nodeId}:${s.stageId ?? ""}`)
        .join("|"),
    [blueprint]
  );

  const compiledGraph = useMemo(
    () => compileTopology(schema),
    [schema]
  );

  const applyValidatedEdges = useCallback(
    (layoutedEdges: Edge[]) => {
      return layoutedEdges.map((e) => {
        const muted = Boolean((e.data as { mutedBus?: boolean } | undefined)?.mutedBus);
        const next: Edge = {
          ...e,
          deletable: isEditableProcessEdgeId(e.id),
          selectable: isEditableProcessEdgeId(e.id) || !muted,
          sourceHandle: e.sourceHandle ?? "right",
          targetHandle: e.targetHandle ?? "left",
        };
        if (invalidNodeIds.has(e.target)) {
          next.animated = true;
          next.style = {
            ...e.style,
            stroke: "rgba(239, 68, 68, 0.6)",
            strokeWidth: 3,
          };
        }
        return next;
      });
    },
    [invalidNodeIds]
  );

  const applySimulationHighlight = useCallback(
    (layoutedNodes: Node[]) =>
      layoutedNodes.map((n) => ({
        ...n,
        deletable: false,
        className:
          simulatedNodeId != null && n.id === simulatedNodeId
            ? "simulation-pulse"
            : undefined,
      })),
    [simulatedNodeId]
  );

  const layoutRunId = useRef(0);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const fittedWalkthrough = useRef<string | null>(null);

  const rebuildLayout = useCallback(() => {
    const runId = ++layoutRunId.current;
    const applyIfCurrent = (layoutedNodes: Node[], sourceEdges: Edge[]) => {
      if (runId !== layoutRunId.current) return;
      setNodes(applySimulationHighlight(layoutedNodes));
      setEdges(applyValidatedEdges(sourceEdges));
      if (
        walkthroughId &&
        fittedWalkthrough.current !== walkthroughId
      ) {
        fittedWalkthrough.current = walkthroughId;
        requestAnimationFrame(() => {
          flowRef.current?.fitView({
            padding: 0.1,
            maxZoom: 0.9,
            minZoom: 0.25,
          });
        });
      }
    };

    void (async () => {
      try {
        if (operationalTasks.length > 0) {
          const { nodes: layoutedNodes, edges: sourceEdges } =
            await layoutOperationalTasks(
              operationalTasks,
              operationalLayoutEngine,
              operationalLayoutDirection,
              { heldTaskIds, walkthroughId, processLinks }
            );
          applyIfCurrent(layoutedNodes, sourceEdges);
          return;
        }
        const { nodes: layoutedNodes, edges: sourceEdges } =
          buildBlueprintLayoutGraph(
            blueprint,
            compiledGraph.nodes,
            compiledGraph.edges
          );
        applyIfCurrent(layoutedNodes, sourceEdges);
      } catch (err) {
        if (runId !== layoutRunId.current) return;
        console.warn("Failed to load operational layout", err);
      }
    })();
  }, [
    operationalTasks,
    operationalLayoutEngine,
    operationalLayoutDirection,
    heldTaskIds,
    walkthroughId,
    processLinks,
    blueprint,
    compiledGraph,
    setNodes,
    setEdges,
    applyValidatedEdges,
    applySimulationHighlight,
  ]);

  useEffect(() => {
    if (!walkthroughId) fittedWalkthrough.current = null;
  }, [walkthroughId]);

  useEffect(() => {
    if (isHydrated.current) return;
    isHydrated.current = true;
    setMounted(true);
    requestAnimationFrame(rebuildLayout);
  }, [rebuildLayout]);

  /* Re-layout when schema revision, operational tasks, blueprint, or view tab changes */
  useEffect(() => {
    if (!mounted) return;
    if (controlPlaneView === "gantt") return;
    rebuildLayout();
  }, [
    mounted,
    schemaRevision,
    operationalLayoutKey,
    blueprintLayoutKey,
    rebuildLayout,
    controlPlaneView,
    operationalLayoutEngine,
    operationalLayoutDirection,
  ]);

  /* Re-apply simulation pulse when payload moves or blueprint relayouts */
  useEffect(() => {
    if (!mounted) return;
    setNodes((prev) => applySimulationHighlight(prev));
  }, [
    mounted,
    simulatedNodeId,
    blueprintLayoutKey,
    applySimulationHighlight,
    setNodes,
  ]);

  /* Mount trigger feeders onto the operational town grid without wiping racks */
  useEffect(() => {
    if (operationalTasks.length === 0) return;
    setEdges((prev) => {
      const mounted = new Set(
        useTopologyStore.getState().graphNodes.map((n) => n.id)
      );
      const base = prev.filter(
        (edge) =>
          !String(edge.id).startsWith("e-trig-") &&
          !String(edge.id).startsWith("ping-") &&
          !String(edge.id).startsWith("cyan-")
      );
      const feeders = (pendingFeederEdges ?? []).filter(
        (edge) =>
          mounted.has(edge.source) &&
          mounted.has(edge.target) &&
          edge.source !== edge.target
      );
      if (feeders.length === 0) return base;
      const ids = new Set(feeders.map((edge) => edge.id));
      return [...base.filter((edge) => !ids.has(edge.id)), ...feeders];
    });
  }, [operationalTasks.length, pendingFeederEdges, setEdges]);

  /* Mount Grid Tie feeder drops for the active cascade; force overhead bus type */
  useEffect(() => {
    if (operationalTasks.length > 0) return;
    const feeders = pendingFeederEdges ?? [];
    const feederIds = new Set(feeders.map((e) => e.id));
    setEdges([
      ...compiledGraph.edges
        .filter((e) => !feederIds.has(e.id))
        .map((e) => {
          const isInvalid = invalidNodeIds.has(e.target);
          return {
            ...e,
            type:
              (e.data as { feeder?: boolean } | undefined)?.feeder === true
                ? "beam"
                : "trunkBus",
            ...(isInvalid
              ? {
                  animated: true,
                  style: {
                    ...e.style,
                    stroke: "rgba(239, 68, 68, 0.6)",
                    strokeWidth: 3,
                  },
                }
              : {}),
          };
        }),
      ...feeders,
    ]);
  }, [
    operationalTasks.length,
    pendingFeederEdges,
    compiledGraph.edges,
    setEdges,
    invalidNodeIds,
  ]);

  useEffect(() => {
    setGraph(nodes, edges);
  }, [nodes, edges, setGraph]);

  useEffect(() => {
    if (!layoutEditMode) return;
    saveLayout(nodes);
  }, [nodes, layoutEditMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (movieMode) {
          exitMovie();
          return;
        }
        if (showJourneyBuilder) {
          setShowJourneyBuilder(false);
          return;
        }
        if (useTopologyStore.getState().isIntegrationEditorOpen) {
          useTopologyStore.getState().closeIntegrationEditor();
          return;
        }
        clearTrace();
      }
      if (e.key === "ArrowRight" || e.key === "n" || e.key === "N") {
        if (
          e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "SELECT" ||
            e.target.tagName === "TEXTAREA")
        ) {
          return;
        }
        e.preventDefault();
        void stepNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    clearTrace,
    stepNext,
    movieMode,
    exitMovie,
    showJourneyBuilder,
    setShowJourneyBuilder,
  ]);

  const onPaneClick = useCallback(() => {
    if (movieMode) return;
    clearTrace();
    useTopologyStore.getState().closeIntegrationEditor();
    useTopologyStore.getState().selectMapNode(null);
    useTopologyStore.getState().setPendingMapLink(null);
  }, [clearTrace, movieMode]);

  const onNodeClick = useCallback(
    (_e: MouseEvent, node: Node) => {
      if (movieMode) return;
      if (
        node.type === "zone" ||
        node.type === "gridTie" ||
        node.type === "blankSlot"
      ) {
        return;
      }
      const store = useTopologyStore.getState();
      const pending = store.pendingMapLink;
      if (pending) {
        if (pending.nodeId !== node.id) {
          if (pending.role === "output") {
            store.addProcessLink(pending.nodeId, node.id);
          } else {
            store.addProcessLink(node.id, pending.nodeId);
          }
        }
        store.setPendingMapLink(null);
        store.selectMapNode(pending.nodeId);
        return;
      }
      store.selectMapNode(node.id);
    },
    [movieMode]
  );

  const onEdgeClick = useCallback(
    (_e: MouseEvent, edge: Edge) => {
      if (movieMode) return;
      if (!isEditableProcessEdgeId(edge.id)) return;
      const store = useTopologyStore.getState();
      const selected = store.selectedMapNodeId;
      if (selected && (edge.source === selected || edge.target === selected)) {
        store.removeProcessLink(edge.source, edge.target);
        return;
      }
      store.selectMapNode(edge.source);
    },
    [movieMode]
  );

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    useTopologyStore.getState().addProcessLink(connection.source, connection.target);
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const remove = useTopologyStore.getState().removeProcessLink;
    for (const edge of deleted) {
      if (!isEditableProcessEdgeId(edge.id)) continue;
      remove(edge.source, edge.target);
    }
  }, []);

  const onBeforeDelete = useCallback<OnBeforeDelete>(
    async ({ edges: delEdges }) => {
      if (movieMode) return { nodes: [], edges: [] };
      return {
        nodes: [],
        edges: delEdges.filter((e) => isEditableProcessEdgeId(e.id)),
      };
    },
    [movieMode]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const source = connection.source;
      const target = connection.target;
      if (!source || !target || source === target) return false;
      const nodes = useTopologyStore.getState().graphNodes;
      const ok = (id: string) => {
        const n = nodes.find((node) => node.id === id);
        return Boolean(
          n &&
            n.type !== "zone" &&
            n.type !== "gridTie" &&
            n.type !== "blankSlot" &&
            isMappableNodeId(id)
        );
      };
      return ok(source) && ok(target);
    },
    []
  );

  const handleStartMovie = useCallback(() => {
    const config =
      journeyBuilder.funnel === "trade"
        ? { ...journeyBuilder, region: "ca" as const }
        : journeyBuilder;
    useTopologyStore.getState().setCustomSequence(buildCustomSequence(config));
    playMovie();
  }, [journeyBuilder, playMovie]);

  useEffect(() => {
    setCanvasEdgesMuted(true);
  }, [setCanvasEdgesMuted]);

  const flowEdges = useMemo(() => {
    if (!canvasEdgesMuted) return edges;
    const visible = collectScenarioVisibleEdgeIds({
      travelEdgeIds,
      trailEdgeIds,
      feederEdgeIds,
      retractingEdgeIds,
      pendingFeederEdges,
    });
    return muteEdgesForCanvas(edges, visible);
  }, [
    edges,
    canvasEdgesMuted,
    travelEdgeIds,
    trailEdgeIds,
    feederEdgeIds,
    retractingEdgeIds,
    pendingFeederEdges,
  ]);

  const handleScenarioSelect = useCallback(
    (scenarioId: LeadScenarioId) => {
      setScenarioModalOpen(false);
      playLeadScenario(scenarioId);
    },
    [playLeadScenario],
  );

  const handleResetScenario = useCallback(() => {
    resetPlayback();
    setScenarioModalOpen(false);
  }, [resetPlayback]);

  const progress =
    playbackState === "idle" && stepIndex === 0
      ? 0
      : Math.round(((stepIndex + 1) / Math.max(seqLen, 1)) * 100);

  if (!mounted) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
        Loading topology…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {movieMode ? (
        <MovieModeBar
          steps={steps}
          seqLen={seqLen}
          progress={progress}
          color={color}
          onPause={pause}
          onExit={exitMovie}
        />
      ) : (
        <DashboardHeader
          progress={progress}
          onResetScenario={handleResetScenario}
          scenarioActive={
            leadScenarioId != null ||
            playbackState === "playing" ||
            playbackState === "paused"
          }
          onPause={pause}
          onStepNext={() => void stepNext()}
          onResetPlayback={resetPlayback}
        />
      )}

      {!movieMode ? (
        <ScenarioSelectorModal
          open={scenarioModalOpen}
          onClose={() => setScenarioModalOpen(false)}
          onSelect={handleScenarioSelect}
        />
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {controlPlaneView === "gantt" && !movieMode ? (
          <GanttControlPlane />
        ) : (
          <>
            {false ? (
              <div className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-950/95 px-3 py-1.5 text-[11px] text-amber-100 shadow-lg">
                Layout Studio
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                background:
                  "radial-gradient(ellipse 70% 45% at 15% 40%, rgba(34,211,238,0.06), transparent 55%), radial-gradient(ellipse 50% 40% at 80% 55%, rgba(232,121,249,0.04), transparent 50%)",
              }}
            />
            <BeamDefs />
            {walkthroughId ? null : <RoadmapIdleSplash />}
            <ConnectionMapPanel />
            <ReactFlow
              nodes={nodes}
              edges={flowEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onPaneClick={onPaneClick}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onBeforeDelete={onBeforeDelete}
              onInit={(instance) => {
                flowRef.current = instance;
                if (operationalTasks.length === 0) {
                  requestAnimationFrame(() => {
                    instance.fitView({
                      padding: 0.12,
                      maxZoom: 0.85,
                      minZoom: 0.18,
                    });
                  });
                }
              }}
              isValidConnection={isValidConnection}
              nodesDraggable={layoutEditMode && !movieMode}
              nodesConnectable={!movieMode && Boolean(walkthroughId)}
              elementsSelectable={!movieMode}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView={false}
              fitViewOptions={{ padding: 0.1, maxZoom: 0.9, minZoom: 0.25 }}
              minZoom={0.25}
              maxZoom={1.4}
              connectionMode={ConnectionMode.Loose}
              proOptions={{ hideAttribution: true }}
              className="topology-flow !h-full !w-full"
              defaultEdgeOptions={
                (operationalTasks.length > 0
                  ? { type: "beam", zIndex: 0, animated: false }
                  : { type: "trunkBus", zIndex: 0, animated: false }) as DefaultEdgeOptions
              }
              elevateNodesOnSelect
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={28}
                size={1}
                color="#1e293b"
              />
              {!movieMode && walkthroughId ? (
                <Controls
                  className="!overflow-hidden !rounded-lg !border !border-slate-700 !bg-slate-950/90"
                  style={{ bottom: 24 }}
                />
              ) : null}
              <MovieCamera />
              {!movieMode && walkthroughId ? (
                <MiniMap
                  className="!overflow-hidden !rounded-lg !border !border-slate-700 !bg-slate-950/90"
                  nodeColor={(n) => (n.type === "zone" ? "#0f172a" : "#134e4a")}
                  maskColor="rgba(2,6,23,0.8)"
                />
              ) : null}
            </ReactFlow>

            <AnimatePresence>
              {showJourneyBuilder && !movieMode ? (
                <JourneyBuilderOverlay
                  onStartMovie={handleStartMovie}
                  onCancel={() => setShowJourneyBuilder(false)}
                />
              ) : null}
            </AnimatePresence>

            <StoryCardPanel />
          </>
        )}
        <RightSidebar />
        <InspectorDrawer />
        <IntegrationEditorPanel />
      </div>
    </div>
  );
}

export default function TopologyDashboard() {
  return (
    <ReactFlowProvider>
      <TopologyCanvas />
    </ReactFlowProvider>
  );
}
