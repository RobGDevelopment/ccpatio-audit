/**
 * Demo work orders — hierarchical WBS + parallel FS scheduling.
 * Touchpoints only: no material / SKU / finish shadow payloads.
 */

import type { WorkOrderInstance, WorkOrderTask } from "./schemaTypes";
import {
  GANTT_MASTER_STEPS,
  GANTT_ZONE_COLORS,
  GANTT_ZONE_PROJECTS,
  zoneProjectId,
} from "./ganttMasterSequence";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function stepTaskId(moPrefix: string, step: number): string {
  return `${moPrefix}-s${String(step).padStart(2, "0")}`;
}

/**
 * Schedule by max(predecessor.end) — enables true parallel tracks.
 */
function scheduleParallel(
  moPrefix: string,
  start: Date
): Map<number, { start: Date; end: Date }> {
  const byStep = new Map(GANTT_MASTER_STEPS.map((s) => [s.step, s]));
  const out = new Map<number, { start: Date; end: Date }>();
  const visiting = new Set<number>();

  function resolve(step: number): { start: Date; end: Date } {
    const cached = out.get(step);
    if (cached) return cached;
    if (visiting.has(step)) {
      const s = new Date(start);
      return { start: s, end: addDays(s, 1) };
    }
    visiting.add(step);
    const def = byStep.get(step)!;
    let earliest = new Date(start);
    for (const dep of def.dependsOnSteps) {
      const d = resolve(dep);
      if (d.end > earliest) earliest = new Date(d.end);
    }
    const end =
      def.type === "milestone"
        ? new Date(earliest)
        : addDays(earliest, Math.max(def.days, 1));
    const range = { start: earliest, end };
    out.set(step, range);
    visiting.delete(step);
    return range;
  }

  for (const s of GANTT_MASTER_STEPS) resolve(s.step);
  return out;
}

function buildMasterSpine(
  moPrefix: string,
  start: Date,
  progressThroughStep: number
): { tasks: WorkOrderTask[]; links: WorkOrderInstance["links"] } {
  const schedule = scheduleParallel(moPrefix, start);
  const tasks: WorkOrderTask[] = [];
  let displayOrder = 0;

  for (const zp of GANTT_ZONE_PROJECTS) {
    const children = GANTT_MASTER_STEPS.filter((s) => s.zoneId === zp.zoneId).sort(
      (a, b) => a.step - b.step
    );
    const starts = children.map((c) => schedule.get(c.step)!.start);
    const ends = children.map((c) => schedule.get(c.step)!.end);
    const zStart = starts.reduce((a, b) => (a < b ? a : b));
    const zEnd = ends.reduce((a, b) => (a > b ? a : b));
    const done = children.filter((c) => c.step <= progressThroughStep).length;
    const parentId = zoneProjectId(moPrefix, zp.zoneId);

    tasks.push({
      id: parentId,
      nodeId: `zone-${zp.zoneId}`,
      stageId: null,
      name: `${zp.wbsCode}  ${zp.name}`,
      parentTaskId: null,
      type: "project",
      start: iso(zStart),
      end: iso(zEnd),
      progress: Math.round((done / Math.max(children.length, 1)) * 100),
      dependencies: [],
      displayOrder: displayOrder++,
      shadow: {},
      zoneId: zp.zoneId,
      zoneColor: GANTT_ZONE_COLORS[zp.zoneId],
      wbsCode: zp.wbsCode,
    });

    for (const step of children) {
      const range = schedule.get(step.step)!;
      const id = stepTaskId(moPrefix, step.step);
      const depIds = step.dependsOnSteps.map((n) => stepTaskId(moPrefix, n));

      tasks.push({
        id,
        nodeId: step.nodeId,
        stageId: step.stageId ?? null,
        name: `${step.wbsCode}  ${step.name}`,
        parentTaskId: parentId,
        type: step.type,
        start: iso(range.start),
        end: iso(step.type === "milestone" ? range.start : range.end),
        progress:
          step.step <= progressThroughStep
            ? 100
            : step.step === progressThroughStep + 1
              ? 45
              : 0,
        dependencies: depIds,
        displayOrder: displayOrder++,
        shadow: {},
        zoneId: step.zoneId,
        zoneColor: step.zoneColor,
        wbsCode: step.wbsCode,
      });
    }
  }

  const links = tasks
    .filter((t) => t.type !== "project" && t.dependencies.length > 0)
    .flatMap((t) =>
      t.dependencies.map((src, i) => ({
        id: `lnk-${t.id}-${i}`,
        sourceTaskId: src,
        targetTaskId: t.id,
        type: "FS" as const,
      }))
    );

  return { tasks, links };
}

export function buildDemoWorkOrders(): WorkOrderInstance[] {
  const mo1 = buildMasterSpine("mo-1042", new Date("2026-08-04"), 38);
  const mo2 = buildMasterSpine("mo-1048", new Date("2026-08-11"), 23);
  const mo3 = buildMasterSpine("mo-1055", new Date("2026-08-18"), 13);

  return [
    {
      moId: "MO-1042",
      label: "MO-1042 · Scottsdale · Lounge Set",
      workflowId: "retail-full",
      customerName: "Henderson Residence",
      region: "AZ",
      status: "in_production",
      tasks: mo1.tasks,
      links: mo1.links,
    },
    {
      moId: "MO-1048",
      label: "MO-1048 · Solana Beach · Dining + Fire",
      workflowId: "trade-full",
      customerName: "Pacific Trade Co.",
      region: "CA",
      status: "in_production",
      tasks: mo2.tasks,
      links: mo2.links,
    },
    {
      moId: "MO-1055",
      label: "MO-1055 · Scottsdale · Dekton Table",
      workflowId: "retail-full",
      customerName: "Desert Modern LLC",
      region: "AZ",
      status: "draft",
      tasks: mo3.tasks,
      links: mo3.links,
    },
  ];
}
