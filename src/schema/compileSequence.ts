/**
 * Project MasterWorkflowSchema → SequenceStep[] for Movie Mode.
 * Retail happy path is ALWAYS the AG JSON 50-step sequence (no board skip).
 */

import type { MasterWorkflowSchema, WorkflowDef } from "./schemaTypes";

type SequenceStep = {
  nodeId: string;
  travelEdges: string[];
  stageId?: string;
  dwellMs?: number;
  fanOutNodes?: string[];
  externalTrigger?: {
    travelEdges: string[];
    targetNodeIds: string[];
    travelMs?: number;
    holdMs?: number;
  };
  storyKey?: string;
  tone?: "happy" | "exception";
};

export function findWorkflow(
  schema: MasterWorkflowSchema,
  journeyId: string,
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
  journeyId: string,
  _mode: "full" | "board" = "full"
): SequenceStep[] {
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
