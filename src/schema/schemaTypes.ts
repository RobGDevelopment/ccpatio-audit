/**
 * Master Workflow Schema — dual-layer Control Plane types (Zod).
 * Workflow DAG template + Work Order / Shadow IT payload instances.
 */

import { z } from "zod";

export const UtilityKindSchema = z.enum([
  "digital",
  "physical",
  "financial",
  "comms",
]);
export const GridLevelSchema = z.enum(["trunk", "branch", "local"]);
export const IntegrationKindSchema = z.enum([
  "none",
  "ghl",
  "katana",
  "qbo",
  "clover",
  "ingress",
  "inngest",
  "redis",
  "postgres",
]);
export const NodeKindSchema = z.enum([
  "zone",
  "gridTie",
  "system",
  "pipeline",
  "stage",
]);
export const EdgeKindSchema = z.enum(["flow", "sync", "feeder"]);
export const PuDropSchema = z.enum(["PU", "DROP", ""]).or(z.literal(""));

/** Shadow IT — institutional shop-floor columns */
export const ShadowItPayloadSchema = z.object({
  puDrop: z.enum(["PU", "DROP"]).optional().nullable(),
  metal: z.string().optional().nullable(),
  powderCoatColor: z.string().optional().nullable(),
  dektonSlabId: z.string().optional().nullable(),
  fabricSku: z.string().optional().nullable(),
  cushionCorte: z.enum(["pending", "in_progress", "done", "n/a"]).optional().nullable(),
  cushionSew: z.enum(["pending", "in_progress", "done", "n/a"]).optional().nullable(),
  cushionFill: z.enum(["pending", "in_progress", "done", "n/a"]).optional().nullable(),
  thirdPartyUmbrella: z.boolean().optional().nullable(),
  thirdPartyFirepit: z.boolean().optional().nullable(),
  thirdPartyTenjam: z.boolean().optional().nullable(),
});
export type ShadowItPayload = z.infer<typeof ShadowItPayloadSchema>;

export const ZoneDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  accent: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ZoneDef = z.infer<typeof ZoneDefSchema>;

export const PipelineStageDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  dimmed: z.boolean().optional(),
  roleLabel: z.string().optional().nullable(),
});
export type PipelineStageDef = z.infer<typeof PipelineStageDefSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  zoneId: z.string().optional().nullable(),
  label: z.string(),
  subtitle: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  accent: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  stageId: z.string().optional().nullable(),
  stages: z.array(PipelineStageDefSchema).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  zIndex: z.number().optional().nullable(),
  durationDays: z.number().default(0),
  instant: z.boolean().optional(),
  slaPhase: z.number().optional().nullable(),
  integration: IntegrationKindSchema.default("none"),
  roleLabel: z.string().optional().nullable(),
  /** Allowed manufacturing keys for this building/task */
  payloadKeys: z.array(z.string()).optional(),
  rfType: z.string().optional().nullable(),
  selectable: z.boolean().optional(),
  draggable: z.boolean().optional(),
  extent: z.enum(["parent"]).optional().nullable(),
  style: z.record(z.string(), z.unknown()).optional().nullable(),
  dataExtra: z.record(z.string(), z.unknown()).optional().nullable(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional().nullable(),
  targetHandle: z.string().optional().nullable(),
  kind: EdgeKindSchema.default("flow"),
  utility: UtilityKindSchema.optional().nullable(),
  gridLevel: GridLevelSchema.optional().nullable(),
  cable: z.boolean().optional(),
  label: z.string().optional().nullable(),
  brief: z.boolean().optional(),
  lane: z.string().optional().nullable(),
  hidden: z.boolean().optional(),
  zIndex: z.number().optional().nullable(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const ExternalTriggerSchema = z.object({
  travelEdges: z.array(z.string()),
  targetNodeIds: z.array(z.string()),
  travelMs: z.number().optional().nullable(),
  holdMs: z.number().optional().nullable(),
});

export const WorkflowStepSchema = z.object({
  stepIndex: z.number(),
  nodeId: z.string(),
  stageId: z.string().optional().nullable(),
  digitalTrigger: z.string(),
  travelEdges: z.array(z.string()),
  dwellMs: z.number().optional().nullable(),
  fanOutNodes: z.array(z.string()).optional(),
  externalTrigger: ExternalTriggerSchema.optional().nullable(),
  storyKey: z.string().optional().nullable(),
  tone: z.enum(["happy", "exception"]).optional().nullable(),
  durationDays: z.number().default(0),
  humanRole: z.string().optional().nullable(),
  systemAutomation: z.string().optional().nullable(),
  inputsRequired: z.array(z.string()).default([]),
  outputsGenerated: z.array(z.string()).default([]),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  journeyId: z.string(),
  mode: z.enum(["full", "board"]),
  workflowType: z.enum(["happy_path", "exception"]),
  steps: z.array(WorkflowStepSchema),
});
export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;

export const WorkOrderTaskSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  stageId: z.string().optional().nullable(),
  name: z.string(),
  parentTaskId: z.string().optional().nullable(),
  type: z.enum(["project", "task", "milestone"]).default("task"),
  start: z.string(), // ISO date
  end: z.string(),
  progress: z.number().min(0).max(100).default(0),
  dependencies: z.array(z.string()).default([]),
  displayOrder: z.number().optional(),
  shadow: ShadowItPayloadSchema.default({}),
  /** Blueprint zone id (z0–z8) from GANTT_MASTER_SEQUENCE */
  zoneId: z.string().optional().nullable(),
  /** Hex accent for Dark Grid bar theming */
  zoneColor: z.string().optional().nullable(),
  /** Hierarchical WBS code e.g. 6.13 */
  wbsCode: z.string().optional().nullable(),
});
export type WorkOrderTask = z.infer<typeof WorkOrderTaskSchema>;

export const WorkOrderLinkSchema = z.object({
  id: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  type: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
});
export type WorkOrderLink = z.infer<typeof WorkOrderLinkSchema>;

export const WorkOrderInstanceSchema = z.object({
  moId: z.string(),
  label: z.string(),
  workflowId: z.string(),
  customerName: z.string().optional().nullable(),
  region: z.enum(["AZ", "CA", "WA"]).optional().nullable(),
  status: z.enum(["draft", "in_production", "ready", "delivered"]).default("in_production"),
  tasks: z.array(WorkOrderTaskSchema),
  links: z.array(WorkOrderLinkSchema).default([]),
});
export type WorkOrderInstance = z.infer<typeof WorkOrderInstanceSchema>;

export const MasterWorkflowSchemaSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  sourceFiles: z.array(z.string()),
  zones: z.array(ZoneDefSchema),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  workflows: z.array(WorkflowDefSchema),
  workOrders: z.array(WorkOrderInstanceSchema).default([]),
});
export type MasterWorkflowSchema = z.infer<typeof MasterWorkflowSchemaSchema>;

export function parseMasterSchema(data: unknown): MasterWorkflowSchema {
  return MasterWorkflowSchemaSchema.parse(data);
}
