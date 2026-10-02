"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  KATANA_RESOURCES,
  type KatanaResource,
  type StandardTrackId,
} from "@/lib/factory-routing/resources";
import type { DraftOperationRow } from "./actions";
import { PIM_INPUT, tactileButton } from "./factory-bom-ui";

type Props = {
  itemSku: string;
  ops: DraftOperationRow[];
  isPending: boolean;
  onAdd: (draft: {
    workCenter: string;
    sequence: number;
    setupTimeMins: string;
    runTimeMins: string;
  }) => void;
  onUpdate: (draft: {
    id: string;
    workCenter: string;
    sequence: number;
    setupTimeMins: string;
    runTimeMins: string;
  }) => void;
  onRemove: (id: string) => void;
  onApplyTrack: (trackId: StandardTrackId) => void;
};

function resourceOptionsFor(ops: DraftOperationRow[]): string[] {
  const set = new Set<string>(KATANA_RESOURCES);
  for (const op of ops) {
    if (op.workCenter.trim()) set.add(op.workCenter);
  }
  return [...set];
}

export function BomOperationsPanel({
  itemSku,
  ops,
  isPending,
  onAdd,
  onUpdate,
  onRemove,
  onApplyTrack,
}: Props) {
  const [resource, setResource] = useState<KatanaResource | "">(
    KATANA_RESOURCES[0],
  );
  const [sequence, setSequence] = useState("10");
  const [setupTimeMins, setSetupTimeMins] = useState("");
  const [runTimeMins, setRunTimeMins] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResource, setEditResource] = useState("");
  const [editSequence, setEditSequence] = useState("");
  const [editSetup, setEditSetup] = useState("");
  const [editRun, setEditRun] = useState("");

  const options = useMemo(() => resourceOptionsFor(ops), [ops]);

  useEffect(() => {
    setResource(KATANA_RESOURCES[0]);
    setSequence("10");
    setSetupTimeMins("");
    setRunTimeMins("");
    setEditingId(null);
  }, [itemSku]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!resource) return;
    onAdd({
      workCenter: resource,
      sequence: Number(sequence) || 10,
      setupTimeMins,
      runTimeMins,
    });
    setSetupTimeMins("");
    setRunTimeMins("");
    setSequence(String((Number(sequence) || 10) + 10));
  }

  function startEdit(op: DraftOperationRow): void {
    setEditingId(op.id);
    setEditResource(op.workCenter);
    setEditSequence(String(op.sequence));
    setEditSetup(op.setupTimeMins ?? "");
    setEditRun(op.runTimeMins ?? "");
  }

  function commitEdit(): void {
    if (!editingId || !editResource.trim()) return;
    onUpdate({
      id: editingId,
      workCenter: editResource.trim(),
      sequence: Number(editSequence) || 10,
      setupTimeMins: editSetup,
      runTimeMins: editRun,
    });
    setEditingId(null);
  }

  function handleApplyTrack(trackId: StandardTrackId): void {
    const labels: Record<StandardTrackId, string> = {
      aluminum_frame: "1st-floor Aluminum Frame (Cut → Fab Pod → Finish)",
      cushion: "2nd-floor Cushion (Cut → Sew → Stuff → QC)",
      final_assembly: "Final Assembly convergence (QC → Pack)",
      dekton_top: "Dekton Fabrication",
    };
    const label = labels[trackId];
    if (ops.length > 0) {
      const ok = window.confirm(
        `Replace ${ops.length} existing operation(s) on ${itemSku} with the ${label} Standard Track?`,
      );
      if (!ok) return;
    }
    onApplyTrack(trackId);
  }

  return (
    <div
      data-testid={`factory-bom-ops-${itemSku}`}
      className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
          Operations
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid={`factory-bom-apply-aluminum-frame-${itemSku}`}
            disabled={isPending}
            onClick={() => handleApplyTrack("aluminum_frame")}
            className={`${tactileButton} px-3 py-1.5 text-xs font-medium disabled:opacity-50`}
          >
            Apply Aluminum Frame Routing
          </button>
          <button
            type="button"
            data-testid={`factory-bom-apply-cushion-${itemSku}`}
            disabled={isPending}
            onClick={() => handleApplyTrack("cushion")}
            className={`${tactileButton} px-3 py-1.5 text-xs font-medium disabled:opacity-50`}
          >
            Apply Cushion Routing
          </button>
          <button
            type="button"
            data-testid={`factory-bom-apply-dekton-top-${itemSku}`}
            disabled={isPending}
            onClick={() => handleApplyTrack("dekton_top")}
            className={`${tactileButton} px-3 py-1.5 text-xs font-medium disabled:opacity-50`}
          >
            Apply Dekton Routing
          </button>
          <button
            type="button"
            data-testid={`factory-bom-apply-final-assembly-${itemSku}`}
            disabled={isPending}
            onClick={() => handleApplyTrack("final_assembly")}
            className={`${tactileButton} px-3 py-1.5 text-xs font-medium disabled:opacity-50`}
          >
            Apply Final Assembly Routing
          </button>
        </div>
      </div>

      {ops.some(
        (op) =>
          op.source === "secondary_extract" ||
          op.source === "heuristic" ||
          op.source === "sketchup_geometry",
      ) ? (
        <p className="mb-2 text-[10px] text-amber-700">
          Algorithmic run times · source geometry
        </p>
      ) : null}

      <p className="mb-2 text-[10px] text-slate-500">
        Katana posts Setup + Process rows per Resource (
        <span className="font-mono">resource_name = work_center</span>).
      </p>

      <div className="mb-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-2 font-medium">Operation step</th>
              <th className="py-2 pr-2 font-medium">Resource</th>
              <th className="py-2 pr-2 font-medium">Setup time</th>
              <th className="py-2 pr-2 font-medium">Run time</th>
              <th className="py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ops.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-xs text-slate-500">
                  No operations on this node. Apply a Standard Track above or
                  add a step below.
                </td>
              </tr>
            ) : (
              ops.map((op) =>
                editingId === op.id ? (
                  <tr key={op.id} data-testid={`factory-bom-op-row-${op.id}`}>
                    <td className="py-2 pr-2">
                      <input
                        className={PIM_INPUT}
                        inputMode="numeric"
                        disabled={isPending}
                        value={editSequence}
                        onChange={(e) => setEditSequence(e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className={PIM_INPUT}
                        disabled={isPending}
                        value={editResource}
                        onChange={(e) => setEditResource(e.target.value)}
                      >
                        {resourceOptionsFor([
                          ...ops,
                          { ...op, workCenter: editResource },
                        ]).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className={PIM_INPUT}
                        inputMode="decimal"
                        placeholder="min"
                        disabled={isPending}
                        value={editSetup}
                        onChange={(e) => setEditSetup(e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className={PIM_INPUT}
                        inputMode="decimal"
                        placeholder="min"
                        disabled={isPending}
                        value={editRun}
                        onChange={(e) => setEditRun(e.target.value)}
                      />
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={commitEdit}
                          className="text-xs text-slate-800 hover:text-slate-600 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setEditingId(null)}
                          className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={op.id} data-testid={`factory-bom-op-row-${op.id}`}>
                    <td className="py-2 pr-2 font-mono text-[13px] text-slate-800">
                      {op.sequence}
                    </td>
                    <td className="py-2 pr-2 text-[13px] text-slate-800">
                      {op.workCenter}
                    </td>
                    <td className="py-2 pr-2 text-[11px] text-slate-500">
                      {op.setupTimeMins ?? "—"} min
                    </td>
                    <td className="py-2 pr-2 text-[11px] text-slate-500">
                      {op.runTimeMins ?? "—"} min
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => startEdit(op)}
                          className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => onRemove(op.id)}
                          className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-2 sm:grid-cols-[0.4fr_minmax(0,1.4fr)_0.5fr_0.5fr_auto]"
      >
        <input
          className={PIM_INPUT}
          placeholder="Step"
          inputMode="numeric"
          disabled={isPending}
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          aria-label="Operation step"
        />
        <select
          className={PIM_INPUT}
          disabled={isPending}
          value={resource}
          onChange={(e) => setResource(e.target.value as KatanaResource)}
          aria-label="Resource"
          data-testid={`factory-bom-op-resource-${itemSku}`}
        >
          {options
            .filter((name) =>
              (KATANA_RESOURCES as readonly string[]).includes(name),
            )
            .map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
        </select>
        <input
          className={PIM_INPUT}
          placeholder="Setup min"
          inputMode="decimal"
          disabled={isPending}
          value={setupTimeMins}
          onChange={(e) => setSetupTimeMins(e.target.value)}
          aria-label="Setup time"
        />
        <input
          className={PIM_INPUT}
          placeholder="Run min"
          inputMode="decimal"
          disabled={isPending}
          value={runTimeMins}
          onChange={(e) => setRunTimeMins(e.target.value)}
          aria-label="Run time"
        />
        <button
          type="submit"
          disabled={isPending || !resource}
          className={`${tactileButton} px-3 py-2 text-xs font-medium disabled:opacity-50`}
        >
          Add op
        </button>
      </form>
    </div>
  );
}
