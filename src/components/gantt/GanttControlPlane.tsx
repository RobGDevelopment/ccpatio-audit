"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compileHybridRows,
  getSelectedWorkOrder,
} from "../../schema/compileGantt";
import { useSchemaStore } from "../../schema/schemaStore";
import { useTopologyStore } from "../topology/topologyStore";
import {
  buildCustomSequence,
  INGESTION_OPTIONS,
  type IngestionSource,
} from "../topology/journeyBuilder";
import {
  controlPathToSequence,
  loadControlPathsFromStorage,
  saveControlPathsToStorage,
  sequenceToControlPath,
  type ControlPathMap,
  type ControlPathStep,
} from "../../schema/controlPath";
import { TouchpointList } from "./TouchpointList";
import { ActionCardList } from "../control/ActionCardList";

type ListMode = "zone" | "task";

export function GanttControlPlane() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedMoId = useSchemaStore((s) => s.selectedMoId);
  const setSelectedMoId = useSchemaStore((s) => s.setSelectedMoId);
  const markDirty = useSchemaStore((s) => s.markDirty);

  const journeyBuilder = useTopologyStore((s) => s.journeyBuilder);
  const setJourneyBuilder = useTopologyStore((s) => s.setJourneyBuilder);
  const setCustomSequence = useTopologyStore((s) => s.setCustomSequence);
  const isSimulating = useTopologyStore((s) => s.isSimulating);
  const blueprint = useTopologyStore((s) => s.blueprint);
  const runSimulation = useTopologyStore((s) => s.runSimulation);

  const [mode, setMode] = useState<ListMode>("zone");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [ingest, setIngest] = useState<IngestionSource | "">("");
  const [pathMap, setPathMap] = useState<ControlPathMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPathMap(loadControlPathsFromStorage());
    setHydrated(true);
  }, []);

  const mo = useMemo(
    () => getSelectedWorkOrder(schema, selectedMoId),
    [schema, selectedMoId]
  );

  const allRows = useMemo(() => (mo ? compileHybridRows(mo) : []), [mo]);

  const zoneRows = useMemo(() => {
    if (collapsed.size === 0) return allRows;
    return allRows.filter((r) => {
      if (!r.parentTaskId) return true;
      return !collapsed.has(r.parentTaskId);
    });
  }, [allRows, collapsed]);

  const zoneCount = allRows.filter((r) => r.type === "project").length;
  const stepCount = allRows.filter((r) => r.type !== "project").length;

  const controlRows: ControlPathStep[] = useMemo(() => {
    if (!ingest) return [];
    return pathMap[ingest] ?? [];
  }, [ingest, pathMap]);

  /** Push Control Room path → topology snake + persist */
  const commitPath = useCallback(
    (ingestion: IngestionSource, rows: ControlPathStep[]) => {
      setPathMap((prev) => {
        const next = { ...prev, [ingestion]: rows };
        saveControlPathsToStorage(next);
        return next;
      });
      const seq = controlPathToSequence(rows);
      setCustomSequence(seq);
      setJourneyBuilder({ ...journeyBuilder, ingestion });
      markDirty();
    },
    [journeyBuilder, setCustomSequence, setJourneyBuilder, markDirty]
  );

  const onToggleZone = useCallback((projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const selectIngest = useCallback(
    (ingestion: IngestionSource | "") => {
      setIngest(ingestion);
      if (!ingestion) {
        setCustomSequence(null);
        return;
      }
      const existing = pathMap[ingestion];
      if (existing && existing.length > 0) {
        setCustomSequence(controlPathToSequence(existing));
        setJourneyBuilder({ ...journeyBuilder, ingestion });
        return;
      }
      const seeded = sequenceToControlPath(
        buildCustomSequence({ ...journeyBuilder, ingestion })
      );
      commitPath(ingestion, seeded);
    },
    [
      pathMap,
      journeyBuilder,
      setCustomSequence,
      setJourneyBuilder,
      commitPath,
    ]
  );

  const resetFromTemplate = useCallback(() => {
    if (!ingest) return;
    const seeded = sequenceToControlPath(
      buildCustomSequence({ ...journeyBuilder, ingestion: ingest })
    );
    commitPath(ingest, seeded);
  }, [ingest, journeyBuilder, commitPath]);



  if (!mo) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No work orders in schema seed.
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading control room…
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2">
        <div className="flex rounded-md border border-slate-700 p-0.5">
          {(
            [
              ["zone", "Zone View"],
              ["task", "Task"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded px-3 py-1 text-[10px] uppercase tracking-wider ${
                mode === id
                  ? "bg-cyan-950 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "task" ? (
          <>
            <button
              type="button"
              onClick={() => runSimulation()}
              disabled={isSimulating || blueprint.length === 0}
              className="rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.25)] hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:shadow-none"
            >
              {isSimulating ? "Simulating…" : "Simulate Payload"}
            </button>
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="font-mono uppercase tracking-[0.14em] text-slate-500">
                Ingest type
              </span>
              <select
                value={ingest}
                onChange={(e) =>
                  selectIngest(e.target.value as IngestionSource | "")
                }
                className="max-w-70 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[12px] text-slate-200"
              >
                <option value="">Select Zone 0 channel…</option>
                {INGESTION_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.wbsCode} · {o.label}
                  </option>
                ))}
              </select>
            </label>
            {ingest ? (
              <button
                type="button"
                onClick={resetFromTemplate}
                className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 hover:border-slate-500 hover:text-slate-300"
              >
                Reset from template
              </button>
            ) : null}
          </>
        ) : null}

        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="font-mono uppercase tracking-[0.14em] text-slate-500">
            Work Order
          </span>
          <select
            value={mo.moId}
            onChange={(e) => setSelectedMoId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[12px] text-slate-200"
          >
            {schema.workOrders.map((w) => (
              <option key={w.moId} value={w.moId}>
                {w.label}
              </option>
            ))}
          </select>
        </label>

        <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
          {mo.status.replace("_", " ")}
        </span>

        {mode === "zone" ? (
          <span className="font-mono text-[10px] text-slate-600">
            {stepCount} / 56 steps · {zoneCount} zones
          </span>
        ) : ingest ? (
          <span className="ml-auto font-mono text-[10px] text-amber-500/80">
            Control Room · {controlRows.length} steps → topology snake
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "zone" ? (
          <TouchpointList
            rows={zoneRows}
            collapsed={collapsed}
            onToggleZone={onToggleZone}
          />
        ) : (
          <ActionCardList />
        )}
      </div>
    </div>
    </>
  );
}
