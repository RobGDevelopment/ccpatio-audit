"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { DraftOperationRow } from "./actions";
import { PIM_INPUT } from "./factory-bom-ui";

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
  onRemove: (id: string) => void;
};

export function BomOperationsPanel({
  itemSku,
  ops,
  isPending,
  onAdd,
  onRemove,
}: Props) {
  const [workCenter, setWorkCenter] = useState("");
  const [sequence, setSequence] = useState("10");
  const [setupTimeMins, setSetupTimeMins] = useState("");
  const [runTimeMins, setRunTimeMins] = useState("");

  useEffect(() => {
    setWorkCenter("");
    setSequence("10");
    setSetupTimeMins("");
    setRunTimeMins("");
  }, [itemSku]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!workCenter.trim()) return;
    onAdd({
      workCenter: workCenter.trim(),
      sequence: Number(sequence) || 10,
      setupTimeMins,
      runTimeMins,
    });
    setWorkCenter("");
    setSetupTimeMins("");
    setRunTimeMins("");
    setSequence(String((Number(sequence) || 10) + 10));
  }

  return (
    <div
      data-testid={`factory-bom-ops-${itemSku}`}
      className="mt-4 rounded-lg border border-sky-500/20 bg-sky-950/20 p-3"
    >
      <div className="mb-3 border-b border-sky-500/20 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-300/90">
        Routing / Work Centers
      </div>
      {ops.some(
        (op) =>
          op.source === "secondary_extract" ||
          op.source === "heuristic" ||
          op.source === "sketchup_geometry",
      ) ? (
        <p className="mb-2 text-[10px] text-amber-300/80">
          Algorithmic run times · source geometry
        </p>
      ) : null}
      <ul className="mb-3 divide-y divide-sky-900/40">
        {ops.length === 0 ? (
          <li className="py-2 text-xs text-zinc-500">No operations on this node.</li>
        ) : (
          ops.map((op) => (
            <li
              key={op.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <div className="font-mono text-[13px] text-zinc-100">
                  {op.sequence}. {op.workCenter}
                </div>
                <div className="text-[11px] text-zinc-500">
                  setup {op.setupTimeMins ?? "—"} min · run {op.runTimeMins ?? "—"}{" "}
                  min
                </div>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRemove(op.id)}
                className="text-xs text-zinc-500 hover:text-rose-400 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <form
        onSubmit={handleSubmit}
        className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_0.4fr_0.5fr_0.5fr_auto]"
      >
        <input
          className={PIM_INPUT}
          placeholder="Work center"
          disabled={isPending}
          value={workCenter}
          onChange={(e) => setWorkCenter(e.target.value)}
        />
        <input
          className={PIM_INPUT}
          placeholder="Seq"
          inputMode="numeric"
          disabled={isPending}
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
        />
        <input
          className={PIM_INPUT}
          placeholder="Setup min"
          inputMode="decimal"
          disabled={isPending}
          value={setupTimeMins}
          onChange={(e) => setSetupTimeMins(e.target.value)}
        />
        <input
          className={PIM_INPUT}
          placeholder="Run min"
          inputMode="decimal"
          disabled={isPending}
          value={runTimeMins}
          onChange={(e) => setRunTimeMins(e.target.value)}
        />
        <button
          type="submit"
          disabled={isPending || !workCenter.trim()}
          className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-400/50 hover:text-sky-100 disabled:opacity-50"
        >
          Add op
        </button>
      </form>
    </div>
  );
}
