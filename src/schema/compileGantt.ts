/**
 * Work Order → hybrid touchpoint rows (list + flow canvas).
 */

import type {
  MasterWorkflowSchema,
  WorkOrderInstance,
  WorkOrderTask,
} from "./schemaTypes";
import {
  ganttBarStyles,
  GANTT_MASTER_STEPS,
  GANTT_ZONE_COLORS,
} from "./ganttMasterSequence";
import type { HybridRow } from "./hybridTypes";

export type { HybridRow };
export type WbsRow = HybridRow;

function classifyTouch(
  type: WorkOrderTask["type"],
  role: string
): HybridRow["touchClass"] {
  if (type === "project") return "Zone";
  if (type === "milestone") return "Milestone";
  if (role === "System") return "System";
  return "Human";
}

function depthOf(task: WorkOrderTask, byId: Map<string, WorkOrderTask>): number {
  let d = 0;
  let cur: WorkOrderTask | undefined = task;
  const seen = new Set<string>();
  while (cur?.parentTaskId && !seen.has(cur.id)) {
    seen.add(cur.id);
    d += 1;
    cur = byId.get(cur.parentTaskId);
  }
  return d;
}

function resolveZoneColor(t: WorkOrderTask): string {
  if (t.zoneColor) return t.zoneColor;
  if (t.zoneId && GANTT_ZONE_COLORS[t.zoneId as keyof typeof GANTT_ZONE_COLORS]) {
    return GANTT_ZONE_COLORS[t.zoneId as keyof typeof GANTT_ZONE_COLORS];
  }
  return "#64748b";
}

function roleForTask(t: WorkOrderTask): string {
  if (t.type === "project") return "Zone";
  const step = GANTT_MASTER_STEPS.find((s) => s.wbsCode === t.wbsCode);
  return step?.role ?? "Human";
}

/** @deprecated Prefer compileHybridRows — kept for any residual gantt-task-react use */
export function compileGanttTasks(mo: WorkOrderInstance) {
  return mo.tasks.map((t) => {
    const zoneColor = resolveZoneColor(t);
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      start: new Date(t.start + "T12:00:00"),
      end: new Date(t.end + "T12:00:00"),
      progress: t.progress,
      project: t.parentTaskId ?? undefined,
      dependencies: t.dependencies.length ? [...t.dependencies] : undefined,
      displayOrder: t.displayOrder,
      hideChildren: false,
      styles: ganttBarStyles(zoneColor, t.type),
    };
  });
}

export function compileHybridRows(mo: WorkOrderInstance): HybridRow[] {
  const byId = new Map(mo.tasks.map((t) => [t.id, t]));
  const sorted = [...mo.tasks].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );
  return sorted.map((t) => {
    const zoneColor = resolveZoneColor(t);
    const role = roleForTask(t);
    return {
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode ?? "",
      role,
      touchClass: classifyTouch(t.type, role),
      nodeId: t.type === "project" ? "" : t.nodeId,
      stageId: t.stageId ?? "",
      parentTaskId: t.parentTaskId ?? null,
      type: t.type,
      progress: t.progress,
      depth: depthOf(t, byId),
      zoneId: t.zoneId ?? "",
      zoneColor,
      dependencies: [...t.dependencies],
    };
  });
}

/** Alias for older call sites */
export function compileWbsRows(mo: WorkOrderInstance): HybridRow[] {
  return compileHybridRows(mo);
}

export function getSelectedWorkOrder(
  schema: MasterWorkflowSchema,
  moId: string | null
): WorkOrderInstance | null {
  if (!moId) return schema.workOrders[0] ?? null;
  return (
    schema.workOrders.find((w) => w.moId === moId) ?? schema.workOrders[0] ?? null
  );
}
