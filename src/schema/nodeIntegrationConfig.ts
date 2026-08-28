import type { Node } from "@xyflow/react";
import type { PipelineNodeData, StageNodeData, SystemNodeData } from "../components/topology/nodes";

export type IntegrationSystem =
  | "GHL"
  | "Katana"
  | "WooCommerce"
  | "QBO"
  | "SketchUp"
  | "Other";

export type ExecutionState = "manual" | "automated";

export type TriggerType =
  | "webhook"
  | "polling"
  | "manual_drag"
  | "clover_payment";

export type NodeIntegrationConfig = {
  nodeTitle: string;
  pipelineName: string;
  system: IntegrationSystem;
  executionState: ExecutionState;
  triggerType: TriggerType;
  targetApiRoute: string;
  leanNotes: string;
};

export const INTEGRATION_SYSTEMS: IntegrationSystem[] = [
  "GHL",
  "Katana",
  "WooCommerce",
  "QBO",
  "SketchUp",
  "Other",
];

export const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "polling", label: "Polling" },
  { value: "manual_drag", label: "Manual Drag" },
  { value: "clover_payment", label: "Clover Payment" },
];

export const DEFAULT_INTEGRATION_CONFIG: NodeIntegrationConfig = {
  nodeTitle: "",
  pipelineName: "",
  system: "Other",
  executionState: "manual",
  triggerType: "manual_drag",
  targetApiRoute: "",
  leanNotes: "",
};

function haystack(id: string, data: Record<string, unknown>): string {
  const label = String(data.label ?? data.title ?? "");
  const subtitle = String(data.subtitle ?? data.zone ?? "");
  const stageId = String(data.stageId ?? "");
  const parent = String(data.parentPipelineId ?? "");
  return `${id} ${label} ${subtitle} ${stageId} ${parent}`.toLowerCase();
}

export function inferIntegrationSystem(
  nodeId: string,
  data: Record<string, unknown>
): IntegrationSystem {
  const h = haystack(nodeId, data);
  if (
    /ghl|gohighlevel|hub|lead|sales-az|sales-ca|trade|warranty|commercial|crm|pipeline/.test(
      h
    )
  ) {
    return "GHL";
  }
  if (/katana|factory|manufactur|mo-|mfg|recipe|bom-freeze/.test(h)) {
    return "Katana";
  }
  if (/woo|commerce|cart|checkout|catalog|e-?commerce/.test(h)) {
    return "WooCommerce";
  }
  if (/qbo|quickbooks|invoice|finance|clover|deposit|ledger|accounting/.test(h)) {
    return "QBO";
  }
  if (/sketchup|skp|trimble|survey|design|proposal|3d/.test(h)) {
    return "SketchUp";
  }
  return "Other";
}

export function inferDefaultTrigger(
  nodeId: string,
  data: Record<string, unknown>
): TriggerType {
  const h = haystack(nodeId, data);
  if (/clover|deposit|payment|terminal|undeposited/.test(h)) {
    return "clover_payment";
  }
  if (/approval|client-approval|07|produce-fo|drag|manual/.test(h)) {
    return "manual_drag";
  }
  if (/webhook|hook|ingress|delivered|status/.test(h)) {
    return "webhook";
  }
  if (/poll|sync|reconcile/.test(h)) {
    return "polling";
  }
  return "manual_drag";
}

export function inferDefaultApiRoute(system: IntegrationSystem): string {
  switch (system) {
    case "GHL":
      return "/api/webhooks/ghl";
    case "Katana":
      return "/api/webhooks/katana";
    case "QBO":
      return "/api/webhooks/qbo";
    case "WooCommerce":
      return "/api/webhooks/woocommerce";
    case "SketchUp":
      return "";
    default:
      return "";
  }
}

export function buildIntegrationDefaults(node: Node): NodeIntegrationConfig {
  const data = node.data as Record<string, unknown>;

  let nodeTitle = "";
  let pipelineName = "";

  if (node.type === "stage") {
    const stage = data as unknown as StageNodeData;
    nodeTitle = stage.label;
    pipelineName = stage.parentPipelineId;
  } else if (node.type === "pipeline") {
    const pipe = data as unknown as PipelineNodeData;
    nodeTitle = pipe.title;
    pipelineName = pipe.subtitle ? `${pipe.title} · ${pipe.subtitle}` : pipe.title;
  } else {
    const sys = data as unknown as SystemNodeData;
    nodeTitle = sys.label ?? node.id;
    pipelineName = sys.subtitle ?? sys.zone ?? "";
  }

  const system = inferIntegrationSystem(node.id, data);
  const triggerType = inferDefaultTrigger(node.id, data);

  return {
    ...DEFAULT_INTEGRATION_CONFIG,
    nodeTitle,
    pipelineName,
    system,
    executionState: "manual",
    triggerType,
    targetApiRoute: inferDefaultApiRoute(system),
    leanNotes: "",
  };
}

export function mergeIntegrationConfig(
  existing: NodeIntegrationConfig | undefined,
  defaults: NodeIntegrationConfig
): NodeIntegrationConfig {
  if (!existing) return defaults;
  return {
    ...defaults,
    ...existing,
    nodeTitle: existing.nodeTitle || defaults.nodeTitle,
    pipelineName: existing.pipelineName || defaults.pipelineName,
  };
}
