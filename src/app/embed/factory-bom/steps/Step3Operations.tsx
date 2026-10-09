import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BomOperationsPanel } from "@/app/admin/factory-bom/BomOperationsPanel";
import { applyStandardTrack, type DraftOperationRow } from "@/app/admin/factory-bom/actions";
import type { StandardTrackId } from "@/lib/factory-routing/resources";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";

export function Step3Operations({
  snapshot,
}: {
  snapshot: AirlockSnapshot;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cushionMode, setCushionMode] = useState<"standard" | "vacuum_compressed">("standard");
  const [trackError, setTrackError] = useState<string | null>(null);

  const rootOps = snapshot.operations.filter(o => o.item_sku === snapshot.rootSku);

  const displayOps: DraftOperationRow[] = rootOps.map(op => {
    const vacuumBump = cushionMode === "vacuum_compressed" && op.sequence === 30 && op.work_center === "Assembly";
    return {
      id: op.id,
      itemSku: op.item_sku,
      workCenter: op.work_center,
      sequence: op.sequence,
      setupTimeMins: op.setup_time_mins,
      runTimeMins: vacuumBump ? String(Number(op.run_time_mins) + 15) : op.run_time_mins,
      status: op.status,
      source: op.source,
    };
  });

  function onApplyTrack(trackId: StandardTrackId) {
    setTrackError(null);
    startTransition(async () => {
      const result = await applyStandardTrack({
        itemSku: snapshot.rootSku,
        trackId,
        mode: "replace",
      });
      if (!result.ok) {
        setTrackError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-slate-800">Factory Floor Operations</h2>
        <p className="text-sm text-slate-600">Assign work centers and adjust expected times for {snapshot.rootSku}.</p>
      </div>

      <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
        <span className="text-sm font-semibold text-slate-700">Cushion Fulfillment:</span>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input 
            type="radio" 
            name="cushion_mode" 
            checked={cushionMode === "standard"}
            onChange={() => setCushionMode("standard")}
            className="text-blue-600 focus:ring-blue-500"
          />
          Standard
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input 
            type="radio" 
            name="cushion_mode" 
            checked={cushionMode === "vacuum_compressed"}
            onChange={() => setCushionMode("vacuum_compressed")}
            className="text-blue-600 focus:ring-blue-500"
          />
          Vacuum Compressed
        </label>
      </div>

      {trackError && (
        <p className="text-sm text-red-700">{trackError}</p>
      )}

      <BomOperationsPanel
        itemSku={snapshot.rootSku}
        ops={displayOps}
        isPending={isPending}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onApplyTrack={onApplyTrack}
      />
    </div>
  );
}
