/**
 * Project MasterWorkflowSchema → SequenceStep[] for Movie Mode.
 * Retail happy path is ALWAYS the AG JSON 50-step sequence (no board skip).
 */

import type { SequenceStep } from "../components/topology/sequences";
import type { JourneyId } from "../components/topology/sequences";
import type { MasterWorkflowSchema, WorkflowDef } from "./schemaTypes";
import { AG_RETAIL_HAPPY_PATH } from "./agRetailSequence";

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
  /* Force AG JSON retail-az-e2e-happy-path — wipe legacy board/full drift */
  if (journeyId === "retail") {
    return AG_RETAIL_HAPPY_PATH.map((s) => ({
      ...s,
      travelEdges: [...(s.travelEdges ?? [])],
      fanOutNodes: s.fanOutNodes ? [...s.fanOutNodes] : undefined,
      externalTrigger: s.externalTrigger
        ? {
            ...s.externalTrigger,
            travelEdges: [...s.externalTrigger.travelEdges],
            targetNodeIds: [...s.externalTrigger.targetNodeIds],
          }
        : undefined,
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
