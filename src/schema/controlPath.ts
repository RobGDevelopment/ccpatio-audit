/**
 * Control Room path model — editable snake / WBS sequence that drives topology.
 */

import type { SequenceStep } from "../components/topology/sequences";
import { GANTT_MASTER_STEPS } from "./ganttMasterSequence";
import type { IngestionSource } from "../components/topology/journeyBuilder";

export type ControlPathStep = {
  /** Stable id for reorder / deps (survives renumber) */
  id: string;
  wbsCode: string;
  label: string;
  role: string;
  nodeId: string;
  stageId: string;
  travelEdges: string[];
  /** Dependency targets by stable step id */
  dependsOnIds: string[];
  dwellMs: number;
  storyKey: string;
  tone: "" | "happy" | "exception";
  zoneColor: string;
  fanOutNodes: string[];
};

function uid(): string {
  return `cps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function matchMaster(nodeId: string, stageId?: string) {
  return GANTT_MASTER_STEPS.find(
    (s) =>
      s.nodeId === nodeId && (stageId ? s.stageId === stageId : true)
  );
}

/** Seed Control Room rows from a SequenceStep[] playlist */
export function sequenceToControlPath(
  steps: SequenceStep[]
): ControlPathStep[] {
  const rows: ControlPathStep[] = steps.map((s, i) => {
    const m = matchMaster(s.nodeId, s.stageId);
    return {
      id: uid(),
      wbsCode: m?.wbsCode ?? String(i + 1),
      label:
        m?.name ??
        (s.stageId ? `${s.nodeId} · ${s.stageId}` : s.nodeId),
      role: m?.role ?? "",
      nodeId: s.nodeId,
      stageId: s.stageId ?? "",
      travelEdges: [...(s.travelEdges ?? [])],
      dependsOnIds: [] as string[],
      dwellMs: s.dwellMs ?? 0,
      storyKey: s.storyKey ?? "",
      tone: (s.tone ?? "") as ControlPathStep["tone"],
      zoneColor: m?.zoneColor ?? "#64748b",
      fanOutNodes: s.fanOutNodes ? [...s.fanOutNodes] : [],
    };
  });
  return rows.map((r, i) => ({
    ...r,
    dependsOnIds: i > 0 ? [rows[i - 1]!.id] : [],
  }));
}

/** Export to topology snake SequenceStep[] (array order = travel order) */
export function controlPathToSequence(
  rows: ControlPathStep[]
): SequenceStep[] {
  return rows.map((r) => {
    const step: SequenceStep = {
      nodeId: r.nodeId.trim() || "unnamed",
      travelEdges: r.travelEdges.map((e) => e.trim()).filter(Boolean),
    };
    if (r.stageId.trim()) step.stageId = r.stageId.trim();
    if (r.dwellMs > 0) step.dwellMs = r.dwellMs;
    if (r.storyKey.trim()) step.storyKey = r.storyKey.trim();
    if (r.tone) step.tone = r.tone;
    if (r.fanOutNodes.length) {
      step.fanOutNodes = r.fanOutNodes.map((x) => x.trim()).filter(Boolean);
    }
    return step;
  });
}

export function renumberLinearWbs(
  rows: ControlPathStep[],
  force = false
): ControlPathStep[] {
  return rows.map((r, i) => ({
    ...r,
    wbsCode: force || /^\d+(\.\d+)*$/.test(r.wbsCode.trim())
      ? force
        ? String(i + 1)
        : r.wbsCode
      : r.wbsCode,
  }));
}

/** After reorder: assign sequential WBS 1..n and FS deps to previous row */
export function normalizeAfterReorder(
  rows: ControlPathStep[]
): ControlPathStep[] {
  return rows.map((r, i) => ({
    ...r,
    wbsCode: String(i + 1),
    dependsOnIds: i > 0 ? [rows[i - 1]!.id] : [],
  }));
}

export function moveControlStep(
  rows: ControlPathStep[],
  from: number,
  to: number
): ControlPathStep[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= rows.length ||
    to >= rows.length ||
    from === to
  ) {
    return rows;
  }
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return normalizeAfterReorder(next);
}

export function insertControlStep(
  rows: ControlPathStep[],
  at: number,
  template?: Partial<ControlPathStep>
): ControlPathStep[] {
  const id = uid();
  const rest = { ...(template ?? {}) };
  delete rest.id;
  const row: ControlPathStep = {
    wbsCode: String(at + 1),
    label: "New touchpoint",
    role: "Human",
    nodeId: "new-node",
    stageId: "",
    travelEdges: [],
    dependsOnIds: [],
    dwellMs: 0,
    storyKey: "",
    tone: "",
    zoneColor: "#64748b",
    fanOutNodes: [],
    ...rest,
    id,
  };
  const next = [...rows];
  next.splice(Math.max(0, Math.min(at, rows.length)), 0, row);
  return normalizeAfterReorder(next);
}

export function deleteControlStep(
  rows: ControlPathStep[],
  index: number
): ControlPathStep[] {
  const doomed = rows[index]?.id;
  const next = rows
    .filter((_, i) => i !== index)
    .map((r) => ({
      ...r,
      dependsOnIds: r.dependsOnIds.filter((d) => d !== doomed),
    }));
  return normalizeAfterReorder(next);
}

export type ControlPathMap = Partial<Record<IngestionSource, ControlPathStep[]>>;

const LS_KEY = "ccpatio-control-paths-v1";

export function loadControlPathsFromStorage(): ControlPathMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ControlPathMap;
  } catch {
    return {};
  }
}

export function saveControlPathsToStorage(map: ControlPathMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
