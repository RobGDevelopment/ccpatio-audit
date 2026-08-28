/**
 * Project MasterWorkflowSchema → SequenceStep[] for Movie Mode.
 * Retail happy path is ALWAYS the AG JSON 50-step sequence (no board skip).
 */

import { LIFECYCLE_EXEC_SEQUENCE } from "../components/topology/lifecycleSequence";
import type { SequenceStep } from "../components/topology/sequences";
import type { JourneyId } from "../components/topology/sequences";
import type { MasterWorkflowSchema, WorkflowDef } from "./schemaTypes";

export function findWorkflow(
  schema: MasterWorkflowSchema,
  journeyId: JourneyId | string,
  mode: "full" | "board"
): WorkflowDef | undefined {
  return (
    schema.workflows.find(
      (w) => w.journeyId === journeyId && w.mode === mode
    ) ??
    schema.workflows.find((w) => w.journeyId === journeyId && w.mode === "full")
  );
}

export function compileSequence(
  schema: MasterWorkflowSchema,
  journeyId: JourneyId | string,
  _mode: "full" | "board" = "full"
): SequenceStep[] {
  /* Executive lifecycle map — sequential Node 1→12 for all happy-path journeys */
  if (
    journeyId === "retail" ||
    journeyId === "trade" ||
    journeyId === "warranty"
  ) {
    return LIFECYCLE_EXEC_SEQUENCE.map((s) => ({
      ...s,
      travelEdges: s.travelEdges ? [...s.travelEdges] : undefined,
      fanOutNodes: s.fanOutNodes ? [...s.fanOutNodes] : undefined,
    }));
  }

  const wf = findWorkflow(schema, journeyId, _mode);
  if (!wf) return [];
  return wf.steps.map((s) => {
    const step: SequenceStep = {
      nodeId: s.nodeId,
      travelEdges: [...(s.travelEdges ?? [])],
    };
    if (s.stageId) step.stageId = s.stageId;
    if (s.dwellMs != null) step.dwellMs = s.dwellMs;
    if (s.fanOutNodes?.length) step.fanOutNodes = [...s.fanOutNodes];
    if (s.externalTrigger) {
      step.externalTrigger = {
        travelEdges: [...s.externalTrigger.travelEdges],
        targetNodeIds: [...s.externalTrigger.targetNodeIds],
        ...(s.externalTrigger.travelMs != null
          ? { travelMs: s.externalTrigger.travelMs }
          : {}),
        ...(s.externalTrigger.holdMs != null
          ? { holdMs: s.externalTrigger.holdMs }
          : {}),
      };
    }
    if (s.storyKey) step.storyKey = s.storyKey;
    if (s.tone) step.tone = s.tone;
    return step;
  });
}
