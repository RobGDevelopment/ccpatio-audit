"use client";

import { useTopologyStore } from "../topology/topologyStore";
import { TRIGGER_PALETTE } from "../topology/triggerPaletteData";
import type { PaletteTrigger } from "../topology/triggerPaletteData";

export function RightSidebar() {
  const canvasMode = useTopologyStore((s) => s.canvasMode);
  const rightSidebarOpen = useTopologyStore((s) => s.rightSidebarOpen);
  const setRightSidebarOpen = useTopologyStore((s) => s.setRightSidebarOpen);
  const heldTaskIds = useTopologyStore((s) => s.heldTaskIds);
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const restoreTask = useTopologyStore((s) => s.restoreTask);
  const holdTask = useTopologyStore((s) => s.holdTask);
  const applyTriggerToNode = useTopologyStore((s) => s.applyTriggerToNode);
  const selectedIntegrationNodeId = useTopologyStore(
    (s) => s.selectedIntegrationNodeId
  );
  const selectedTaskId = useTopologyStore((s) => s.selectedTaskId);

  const show = canvasMode === "plan" || rightSidebarOpen;
  if (canvasMode === "present" && !rightSidebarOpen) return null;

  const heldTasks = heldTaskIds
    .map((id) => operationalTasks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t != null);

  const targetId = selectedIntegrationNodeId ?? selectedTaskId;

  const applyTrigger = (trigger: PaletteTrigger) => {
    if (!targetId) {
      window.alert("Select a card on the canvas first, then drop a trigger.");
      return;
    }
    applyTriggerToNode(targetId, {
      triggerType: trigger.triggerType,
      targetApiRoute: trigger.targetApiRoute ?? "",
      executionState:
        trigger.triggerType === "manual_drag" ||
        trigger.triggerType === "clover_payment"
          ? "manual"
          : "automated",
      leanNotes: `Trigger: ${trigger.label} — ${trigger.hint}`,
    });
  };

  return (
    <aside
      className={`pointer-events-auto absolute bottom-0 right-0 top-0 z-40 flex w-[280px] flex-col border-l border-slate-700/80 bg-slate-950/95 shadow-2xl backdrop-blur-md transition-transform duration-300 ${
        show ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-400">
            Plan Tools
          </div>
          <div className="text-sm font-semibold text-slate-100">
            Hold · Triggers · Legend
          </div>
        </div>
        {canvasMode !== "plan" ? (
          <button
            type="button"
            onClick={() => setRightSidebarOpen(false)}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Hold Rack
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Unplug a step from the lifecycle. Held steps are excluded from Play.
          </p>
          {heldTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-[11px] text-slate-600">
              Empty — select a card, then click Unplug below
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {heldTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-slate-200">
                      {task.title}
                    </div>
                    <div className="font-mono text-[9px] text-slate-500">
                      {task.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreTask(task.id)}
                    className="shrink-0 rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/15"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={!targetId || heldTaskIds.includes(targetId)}
            onClick={() => {
              if (targetId) holdTask(targetId);
            }}
            className="mt-3 w-full rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100 disabled:opacity-40"
          >
            Unplug selected card
          </button>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Trigger Palette
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Select a card, then click a trigger to pin it.
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {TRIGGER_PALETTE.map((trigger) => (
              <button
                key={trigger.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-ccpatio-trigger",
                    JSON.stringify(trigger)
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => applyTrigger(trigger)}
                className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-2 text-left hover:border-cyan-500/40 hover:bg-slate-900"
              >
                <span className="text-base leading-none">{trigger.icon}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-100">
                    {trigger.label}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {trigger.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Legend
          </h3>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <li>
              <span className="mr-1.5 text-emerald-300">HUMAN</span> Operator /
              sales / factory step
            </li>
            <li>
              <span className="mr-1.5 text-cyan-300">AUTO</span> System socket
            </li>
            <li>
              <span className="mr-1.5 text-amber-200">GATEWAY</span> Decision /
              payment gate
            </li>
            <li>
              <span className="mr-1.5 text-violet-200">MILESTONE</span> Lifecycle
              checkpoint
            </li>
            <li>
              <span className="mr-1.5">✋ / ⚡</span> Manual vs automated
              execution
            </li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
