"use client";

import { useRef, useState } from "react";
import { parseOperationalTasks } from "../../schema/operationalTask";
import { useTopologyStore } from "../topology/topologyStore";

export function BlueprintPersistenceBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const importTasks = useTopologyStore((s) => s.importTasks);
  const [status, setStatus] = useState<string | null>(null);

  const exportJson = () => {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(operationalTasks, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ccpatio-blueprint-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Blueprint exported.");
  };

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseOperationalTasks(JSON.parse(text));
      importTasks(parsed);
      setStatus(`Imported ${parsed.length} tasks.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to import blueprint JSON."
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={exportJson}
          className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-500/25"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-200 hover:border-slate-400"
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void onFileChosen(e.target.files?.[0])}
        />
      </div>
      {status ? (
        <p className="text-[10px] text-slate-500">{status}</p>
      ) : null}
    </div>
  );
}
