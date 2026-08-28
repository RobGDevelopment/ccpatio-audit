/**
 * Canonical Retail happy path — from AntiGravity_SOP_Ingestion.json
 * workflow `retail-az-e2e-happy-path` (exact 50 steps, step_index order).
 */

import type { SequenceStep } from "../components/topology/sequences";
import agRetail from "./ag_retail_happy_path.json";

type AgStep = {
  step_index: number;
  node_id: string;
  stage_id: string | null;
  story_key: string | null;
  travel_edges: string[];
  tone: "happy" | "exception" | null;
  external_trigger: {
    travel_edges: string[];
    target_node_ids: string[];
    travel_ms: number | null;
    hold_ms: number | null;
  } | null;
};

function agStepToSequence(s: AgStep): SequenceStep {
  const step: SequenceStep = {
    nodeId: s.node_id,
    travelEdges: [...(s.travel_edges ?? [])],
  };
  if (s.stage_id) step.stageId = s.stage_id;
  if (s.story_key) step.storyKey = s.story_key;
  if (s.tone) step.tone = s.tone;
  if (s.external_trigger) {
    step.externalTrigger = {
      travelEdges: [...s.external_trigger.travel_edges],
      targetNodeIds: [...s.external_trigger.target_node_ids],
      ...(s.external_trigger.travel_ms != null
        ? { travelMs: s.external_trigger.travel_ms }
        : {}),
      ...(s.external_trigger.hold_ms != null
        ? { holdMs: s.external_trigger.hold_ms }
        : {}),
    };
  }
  return step;
}

/** Exact 50-step Retail AZ E2E happy path from AG JSON */
export function loadAgRetailHappyPath(): SequenceStep[] {
  const steps = (agRetail as { steps: AgStep[] }).steps;
  if (!steps?.length) {
    throw new Error("ag_retail_happy_path.json has no steps");
  }
  return [...steps]
    .sort((a, b) => a.step_index - b.step_index)
    .map(agStepToSequence);
}

export const AG_RETAIL_HAPPY_PATH: SequenceStep[] = loadAgRetailHappyPath();
