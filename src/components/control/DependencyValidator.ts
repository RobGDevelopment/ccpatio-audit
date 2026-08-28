import { WorkflowStep } from "../../schema/schemaTypes";
import type { OperationalTask } from "../../schema/operationalTask";

export function validateBlueprint(blueprint: WorkflowStep[]): string[] {
  const accumulatedOutputs = new Set<string>();
  const invalidNodeIds = new Set<string>();

  for (const step of blueprint) {
    if (step.inputsRequired && step.inputsRequired.length > 0) {
      for (const input of step.inputsRequired) {
        if (!accumulatedOutputs.has(input)) {
          invalidNodeIds.add(step.nodeId);
          break; // Flag this node as invalid, no need to check other inputs
        }
      }
    }

    if (step.outputsGenerated && step.outputsGenerated.length > 0) {
      for (const output of step.outputsGenerated) {
        accumulatedOutputs.add(output);
      }
    }
  }

  return Array.from(invalidNodeIds);
}

export class SequenceValidationError extends Error {
  readonly nodeId: string;
  readonly missingDep: string;

  constructor(nodeId: string, missingDep: string) {
    super(
      `[DependencyValidator] Invalid Sequence: Node '${nodeId}' requires '${missingDep}' which has not executed yet.`
    );
    this.name = "SequenceValidationError";
    this.nodeId = nodeId;
    this.missingDep = missingDep;
  }
}

export type SequenceValidationIssue = {
  nodeId: string;
  missingDep: string;
  kind: "missing_dep" | "unknown_node" | "forced_order";
};

export type ValidateSequenceOptions = {
  /** When true (default), collect issues instead of throwing. */
  soft?: boolean;
};

/**
 * Live-state sequence validator. Uses the current operationalTasks graph
 * (Zustand), never a frozen seed snapshot — required after Live Rewiring.
 */
export function validateSequencePath(
  sequenceIds: string[],
  liveTasks: OperationalTask[],
  options: ValidateSequenceOptions = { soft: false }
): SequenceValidationIssue[] {
  const soft = options.soft ?? false;
  const issues: SequenceValidationIssue[] = [];
  const byId = new Map(liveTasks.map((task) => [task.id, task]));
  const executed = new Set<string>();

  for (const nodeId of sequenceIds) {
    const task = byId.get(nodeId);
    if (!task) {
      issues.push({ nodeId, missingDep: nodeId, kind: "unknown_node" });
      if (!soft) {
        throw new Error(
          `[DependencyValidator] Invalid Sequence: Node '${nodeId}' is not in the live operational task graph.`
        );
      }
      continue;
    }
    for (const dep of task.dependencies) {
      if (!executed.has(dep)) {
        issues.push({ nodeId, missingDep: dep, kind: "missing_dep" });
        if (!soft) {
          throw new SequenceValidationError(nodeId, dep);
        }
      }
    }
    executed.add(nodeId);
  }

  return issues;
}

/**
 * Reorder (and optionally relax) a playback playlist so executive demos never
 * hard-crash on live rewiring. Preserves original index as tie-breaker.
 * On deadlock, forces the earliest pending node and warns — animation continues.
 */
export function preparePlaybackSequence(
  sequenceIds: string[],
  liveTasks: OperationalTask[]
): { orderedIds: string[]; issues: SequenceValidationIssue[] } {
  const byId = new Map(liveTasks.map((task) => [task.id, task]));
  const indexOf = new Map(sequenceIds.map((id, index) => [id, index]));
  const inSequence = new Set(sequenceIds);
  const issues: SequenceValidationIssue[] = [];

  const pending = new Set(
    sequenceIds.filter((id) => {
      if (byId.has(id)) return true;
      issues.push({ nodeId: id, missingDep: id, kind: "unknown_node" });
      return false;
    })
  );

  const ordered: string[] = [];
  const executed = new Set<string>();

  const depsSatisfied = (nodeId: string) => {
    const task = byId.get(nodeId);
    if (!task) return false;
    return task.dependencies.every(
      (dep) => !inSequence.has(dep) || executed.has(dep)
    );
  };

  while (pending.size > 0) {
    const ready = [...pending]
      .filter(depsSatisfied)
      .sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));

    if (ready.length === 0) {
      const forced = [...pending].sort(
        (a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0)
      )[0]!;
      const task = byId.get(forced)!;
      for (const dep of task.dependencies) {
        if (inSequence.has(dep) && !executed.has(dep)) {
          issues.push({
            nodeId: forced,
            missingDep: dep,
            kind: "forced_order",
          });
        }
      }
      ordered.push(forced);
      executed.add(forced);
      pending.delete(forced);
      continue;
    }

    for (const id of ready) {
      ordered.push(id);
      executed.add(id);
      pending.delete(id);
    }
  }

  return { orderedIds: ordered, issues };
}

export function warnSequenceIssues(issues: SequenceValidationIssue[]): void {
  if (issues.length === 0) return;
  const summary = issues
    .slice(0, 6)
    .map(
      (issue) =>
        `${issue.nodeId}${issue.kind === "unknown_node" ? " (missing task)" : ` ← ${issue.missingDep}`}`
    )
    .join("; ");
  const suffix = issues.length > 6 ? ` (+${issues.length - 6} more)` : "";
  console.warn(
    `[DependencyValidator] Playback sequence adjusted to avoid crash: ${summary}${suffix}`
  );
}
