import { granularNodeId } from "../topology/granularGraph";
import { zoneOfNode } from "../topology/utilityTypes";
import type { WorkflowStep } from "../../schema/schemaTypes";
import {
  parseDurationDays,
  type OperationalTask,
  type OperationalZone,
} from "../../schema/operationalTask";

export {
  EXHAUSTIVE_OPERATIONAL_TASKS,
  EXHAUSTIVE_SEED_VERSION,
} from "../../schema/exhaustiveOperationalSeed";

const ZONE_ID_TO_OPERATIONAL: Record<string, OperationalZone> = {
  z0: "Zone 0: Inbound Marketing",
  z1: "Zone 1: CRM / Inbound Triage",
  z2: "Zone 2: CRM Pipeline",
  z3: "Zone 3: Showroom Sales (AZ/CA)",
  z4: "Zone 4: Design & Cut Lists",
  z5: "Zone 5: Middleware Core",
  z6: "Zone 6: Factory Production & QA",
  z7: "Zone 7: Logistics Dispatch",
  z8: "Zone 8: Treasury & Post-Care",
};

export function inferOperationalZone(nodeId: string): OperationalZone {
  const id = nodeId.toLowerCase();
  if (/traffic-|chan-|showroom-walkin/.test(id)) {
    return "Zone 0: Inbound Marketing";
  }
  if (/ghl-hub/.test(id)) return "Zone 1: CRM / Inbound Triage";
  if (/produce-az|produce-ca|produce-warranty|^az-|^ca-/.test(id)) {
    return "Zone 3: Showroom Sales (AZ/CA)";
  }
  if (
    /lead-|trade-|war-|warranty|commercials-|crm-seg/.test(id)
  ) {
    return "Zone 2: CRM Pipeline";
  }
  if (
    /field-survey|sketchup|cut-lists|bom-packet|qbo-deposit|clover-showroom|payment-gateway/.test(
      id
    )
  ) {
    return "Zone 4: Design & Cut Lists";
  }
  if (/ingress|redis|postgres|inngest|^katana$/.test(id)) {
    return "Zone 5: Middleware Core";
  }
  if (/inventory|procure|outsourced|wc-|qc-|mfg-/.test(id)) {
    return "Zone 6: Factory Production & QA";
  }
  if (/dispatch|delivery/.test(id)) return "Zone 7: Logistics Dispatch";
  if (/qbo|clover|reconcil|postcare|inv-/.test(id)) {
    return "Zone 8: Treasury & Post-Care";
  }
  const zoneId = zoneOfNode(nodeId);
  if (zoneId && ZONE_ID_TO_OPERATIONAL[zoneId]) {
    return ZONE_ID_TO_OPERATIONAL[zoneId];
  }
  return "Zone 0: Inbound Marketing";
}

function inferTechStack(nodeId: string, systemAutomation?: string | null): string[] {
  const stack: string[] = [];
  if (systemAutomation) stack.push(systemAutomation);
  const id = nodeId.toLowerCase();
  if (/ghl|lead|sales|hub|pipe|chan-|war-|trade-|mfg-|az-|ca-/.test(id)) {
    stack.push("GHL");
  }
  if (/katana|mfg|work-center|wc-|qc-/.test(id)) stack.push("Katana");
  if (/qbo/.test(id)) stack.push("QBO");
  if (/clover|stripe|payment/.test(id)) stack.push("Stripe");
  if (/inngest/.test(id)) stack.push("Inngest");
  if (/redis/.test(id)) stack.push("Redis");
  if (/postgres/.test(id)) stack.push("Postgres");
  return [...new Set(stack)];
}

export function workflowStepsToOperationalTasks(
  steps: WorkflowStep[]
): OperationalTask[] {
  const seen = new Set<string>();
  const tasks: OperationalTask[] = [];

  for (const step of steps) {
    let id = granularNodeId(step.nodeId, step.stageId);
    if (seen.has(id)) id = `${id}__${step.stepIndex}`;
    seen.add(id);

    const prev = tasks[tasks.length - 1];
    tasks.push({
      id,
      title: step.digitalTrigger || step.humanRole || step.nodeId,
      zone: inferOperationalZone(step.nodeId),
      duration: step.durationDays
        ? `${step.durationDays}d`
        : step.dwellMs
          ? `${Math.round(step.dwellMs / 1000)}s`
          : "0d",
      dependencies: prev ? [prev.id] : [],
      inputsRequired: step.inputsRequired ?? [],
      outputsGenerated: step.outputsGenerated ?? [],
      digitalTriggers: step.digitalTrigger ? [step.digitalTrigger] : [],
      techStack: inferTechStack(step.nodeId, step.systemAutomation),
      nodeType: "standard",
    });
  }

  return tasks;
}

export function operationalTasksToWorkflowSteps(
  tasks: OperationalTask[]
): WorkflowStep[] {
  return tasks.map((task, index) => ({
    stepIndex: index,
    nodeId: task.id,
    stageId: null,
    digitalTrigger: task.digitalTriggers[0] ?? task.title,
    travelEdges: [],
    dwellMs: null,
    durationDays: parseDurationDays(task.duration),
    humanRole: null,
    systemAutomation: task.techStack[0] ?? null,
    inputsRequired: task.inputsRequired,
    outputsGenerated: task.outputsGenerated,
  }));
}
