"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  RETAIL_AZ_SEQUENCE,
  RETAIL_CA_SEQUENCE,
  TRADE_SEQUENCE,
  WARRANTY_SEQUENCE,
  type SequenceStep,
} from "./sequences";
import {
  immediateOutboundEdges,
  immediateOutgoerIds,
  useTopologyStore,
} from "./topologyStore";
import { resolveStepFocusId } from "./granularGraph";
import { zoneOfNode } from "./utilityTypes";
import { resolvePingTarget, SATELLITE_TARGETS } from "./ghlPipelines";
import { buildPlaybackStepsFromProcessMap } from "./processMap";
import type { Edge } from "@xyflow/react";

const PING_OUT_MS = 900;
const PING_LIT_MS = 1000;
const PING_IN_MS = 900;

function activeSteps(): SequenceStep[] {
  const { journeyId, walkthroughId } = useTopologyStore.getState();
  if (walkthroughId === "solana") return RETAIL_CA_SEQUENCE;
  if (walkthroughId === "trade" || journeyId === "trade") return TRADE_SEQUENCE;
  if (walkthroughId === "warranty" || journeyId === "warranty") {
    return WARRANTY_SEQUENCE;
  }
  return RETAIL_AZ_SEQUENCE;
}

function playbackSteps(): SequenceStep[] {
  const store = useTopologyStore.getState();
  if (store.walkthroughId) {
    const mounted = new Set(store.graphNodes.map((n) => n.id));
    const mapped = buildPlaybackStepsFromProcessMap(
      store.walkthroughId,
      store.processLinksForActive(),
      mounted
    ).filter((step) => mounted.has(step.nodeId));
    if (mapped.length > 0) return mapped;
  }
  return activeSteps();
}

function isMounted(id: string): boolean {
  return useTopologyStore.getState().graphNodes.some((n) => n.id === id);
}

function sleep(ms: number, signal: { aborted: boolean }) {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (signal.aborted) {
        resolve();
        return;
      }
      if (useTopologyStore.getState().playbackState === "paused") {
        window.setTimeout(tick, 80);
        return;
      }
      if (Date.now() - start >= ms) {
        resolve();
        return;
      }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}

function makeCyanEdge(source: string, target: string): Edge {
  return {
    id: `cyan-${source}-${target}`,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "beam",
    zIndex: 10,
  };
}

function makePingEdge(source: string, target: string): Edge {
  return {
    id: `ping-${source}-${target}`,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "ping",
    zIndex: 40,
    data: { satellite: true },
  };
}

function resolvePingList(humanId: string, raw: string[] | undefined): string[] {
  const mounted = new Set(
    useTopologyStore.getState().graphNodes.map((n) => n.id)
  );
  const fromStep = (raw ?? [])
    .map((p) => resolvePingTarget(p, mounted))
    .filter((id): id is string => typeof id === "string" && mounted.has(id));
  if (fromStep.length > 0) return [...new Set(fromStep)];
  const fallback = (SATELLITE_TARGETS[humanId] ?? []).filter((id) =>
    mounted.has(id)
  );
  return [...new Set(fallback)];
}

async function runSatellitePings(
  humanId: string,
  pingTargets: string[],
  signal: { aborted: boolean },
  alive: () => boolean
) {
  const store = () => useTopologyStore.getState();
  const targets = resolvePingList(humanId, pingTargets);
  if (targets.length === 0 || !alive() || !isMounted(humanId)) return;

  const pingEdges: Edge[] = [];
  const litIds = [humanId];

  for (let i = 0; i < targets.length; i++) {
    if (!alive()) return;
    const fromId = i === 0 ? humanId : targets[i - 1]!;
    const toId = targets[i]!;
    const edge = makePingEdge(fromId, toId);
    pingEdges.push(edge);

    useTopologyStore.setState({ pendingFeederEdges: [...pingEdges] });
    await sleep(40, signal);
    if (!alive()) return;

    store().setCameraFocusNodeId(toId);
    store().beginCircuitGrow([edge.id], PING_OUT_MS);
    await sleep(PING_OUT_MS, signal);
    if (!alive()) return;

    litIds.push(toId);
    store().latchCascade({
      nodeIds: [...litIds],
      zoneIds: [],
      originNodeId: humanId,
      originStageId: null,
    });
    useTopologyStore.setState({
      activeNodeId: humanId,
      travelEdgeIds: [],
    });
  }

  store().setCameraFocusNodeId(targets[targets.length - 1] ?? humanId);
  await sleep(PING_LIT_MS, signal);
  if (!alive()) return;

  store().setCameraFocusNodeId(humanId);
  for (let i = pingEdges.length - 1; i >= 0; i--) {
    if (!alive()) return;
    const edge = pingEdges[i]!;
    store().beginCircuitRetract([edge.id], PING_IN_MS);
    await sleep(PING_IN_MS, signal);
    if (!alive()) return;
    const remaining = pingEdges.slice(0, i);
    useTopologyStore.setState({
      pendingFeederEdges: remaining,
      retractingEdgeIds: [],
      travelEdgeIds: [],
      activeNodeId: humanId,
    });
    await sleep(40, signal);
  }

  useTopologyStore.setState({
    pendingFeederEdges: [],
    feederEdgeIds: [],
    travelEdgeIds: [],
    retractingEdgeIds: [],
    returnActive: false,
    activeNodeId: humanId,
  });
}

async function runStep(
  step: SequenceStep,
  previousNodeId: string | null,
  signal: { aborted: boolean },
  runId: number,
  runIdRef: { current: number }
) {
  const store = () => useTopologyStore.getState();
  const alive = () => !signal.aborted && runId === runIdRef.current;

  const { graphNodes, graphEdges } = store();
  if (!graphNodes.some((n) => n.id === step.nodeId)) return;

  const focusId = resolveStepFocusId(step.nodeId, step.stageId);
  const originZone = zoneOfNode(step.nodeId);

  store().setCameraFocusNodeId(focusId);

  if (previousNodeId && isMounted(previousNodeId) && isMounted(step.nodeId)) {
    const existingTravel = (step.travelEdges ?? []).filter((id) =>
      graphEdges.some((e) => e.id === id)
    );
    if (existingTravel.length > 0) {
      const travelMs = 1500;
      store().beginTravel(existingTravel, travelMs);
      await sleep(travelMs, signal);
      if (!alive()) return;
    } else {
      const cyanEdge = makeCyanEdge(previousNodeId, step.nodeId);
      useTopologyStore.setState((s) => ({
        pendingFeederEdges: [
          ...s.pendingFeederEdges.filter(
            (e) => !String(e.id).startsWith("ping-")
          ),
          cyanEdge,
        ],
      }));
      await sleep(40, signal);
      if (!alive()) return;

      const travelMs = 1500;
      store().beginTravel([cyanEdge.id], travelMs);
      await sleep(travelMs, signal);
      if (!alive()) return;
    }
  }

  store().latchCascade({
    nodeIds: [step.nodeId],
    stageIds: step.stageId ? [step.stageId] : [],
    zoneIds: originZone ? [originZone] : [],
    originNodeId: step.nodeId,
    originStageId: step.stageId ?? null,
  });
  useTopologyStore.setState({
    activeNodeId: step.nodeId,
  });

  const immediate = immediateOutgoerIds(focusId, graphNodes, graphEdges);
  const pulse = immediateOutboundEdges(focusId, graphEdges);
  store().beginHold(
    step.nodeId,
    step.stageId,
    immediate,
    pulse,
    step.storyKey,
    step.tone
  );

  await sleep(800, signal);
  if (!alive()) return;

  if (step.pings && step.pings.length > 0) {
    await runSatellitePings(step.nodeId, step.pings, signal, alive);
    if (!alive()) return;
  }

  store().markCompleted(step.nodeId, step.stageId);
  useTopologyStore.setState({
    pendingFeederEdges: store().pendingFeederEdges.filter(
      (e) => !String(e.id).startsWith("ping-")
    ),
    feederEdgeIds: [],
    travelEdgeIds: [],
    retractingEdgeIds: [],
    returnActive: false,
  });
}

/**
 * E2E Snake controller — cyan circuit + red SmoothStep daisy-chain.
 */
export function useSequenceController() {
  const runIdRef = useRef(0);
  const abortRef = useRef({ aborted: false });

  const stopRun = useCallback(() => {
    abortRef.current.aborted = true;
    runIdRef.current += 1;
    abortRef.current = { aborted: true };
  }, []);

  const playFrom = useCallback(
    async (startIndex: number) => {
      stopRun();
      const runId = ++runIdRef.current;
      abortRef.current = { aborted: false };
      const signal = abortRef.current;

      const st = useTopologyStore.getState();
      const steps = playbackSteps();

      st.setPlaybackState("playing");
      let previousNodeId: string | null = null;
      for (let i = startIndex; i < steps.length; i++) {
        if (signal.aborted || runId !== runIdRef.current) return;
        st.setStepIndex(i);
        await runStep(steps[i]!, previousNodeId, signal, runId, runIdRef);
        previousNodeId = steps[i]!.nodeId;
      }
      if (!signal.aborted && runId === runIdRef.current) {
        useTopologyStore.getState().setPlaybackState("idle");
        useTopologyStore.setState({ circuitComplete: true });
      }
    },
    [stopRun]
  );

  const play = useCallback(() => {
    const st = useTopologyStore.getState();
    const i = st.playbackState === "paused" ? st.stepIndex : 0;
    if (st.playbackState === "paused") {
      st.setPlaybackState("playing");
    }
    void playFrom(i);
  }, [playFrom]);

  const pause = useCallback(() => {
    const st = useTopologyStore.getState();
    if (st.playbackState === "playing") {
      st.setPlaybackState("paused");
    } else if (st.playbackState === "paused") {
      st.setPlaybackState("playing");
    }
  }, []);

  const stepNext = useCallback(async () => {
    stopRun();
    const runId = ++runIdRef.current;
    abortRef.current = { aborted: false };
    const signal = abortRef.current;
    const steps = playbackSteps();
    const st = useTopologyStore.getState();
    let i = st.stepIndex;
    const wasIdle = st.playbackState === "idle";
    if (!wasIdle) i = Math.min(i + 1, steps.length - 1);
    if (!steps[i]) return;
    st.setPlaybackState("paused");
    st.setStepIndex(i);
    const previousNodeId = i > 0 ? steps[i - 1]!.nodeId : null;
    await runStep(steps[i]!, previousNodeId, signal, runId, runIdRef);
    if (
      i === steps.length - 1 &&
      !signal.aborted &&
      runId === runIdRef.current
    ) {
      useTopologyStore.setState({ circuitComplete: true });
    }
  }, [stopRun]);

  const playMovie = useCallback(() => {
    useTopologyStore.getState().setMovieMode(true);
    void playFrom(0);
  }, [playFrom]);

  const exitMovie = useCallback(() => {
    stopRun();
    useTopologyStore.getState().setMovieMode(false);
    useTopologyStore.getState().setPlaybackState("idle");
  }, [stopRun]);

  const resetPlayback = useCallback(
    (_steps?: SequenceStep[]) => {
      stopRun();
      void _steps;
      const st = useTopologyStore.getState();
      st.clearCinematicVisuals();
      st.resetJourneyProgress();
      useTopologyStore.setState({
        stepIndex: 0,
        playbackState: "idle",
      });
    },
    [stopRun]
  );

  useEffect(() => {
    return () => {
      stopRun();
    };
  }, [stopRun]);

  return {
    play,
    pause,
    stepNext,
    playMovie,
    exitMovie,
    stopRun,
    resetPlayback,
    playFrom,
  };
}
