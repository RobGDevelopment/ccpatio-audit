"use client";

import { useTopologyStore } from "../topology/topologyStore";
import { OPERATIONAL_NODE_TYPES, OPERATIONAL_ZONES } from "../../schema/operationalTask";
import { TagInput } from "./TagInput";

export function InspectorDrawer() {
  const selectedTaskId = useTopologyStore((s) => s.selectedTaskId);
  const isEditingDrawerOpen = useTopologyStore((s) => s.isEditingDrawerOpen);
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const updateTask = useTopologyStore((s) => s.updateTask);
  const deleteTask = useTopologyStore((s) => s.deleteTask);
  const connectTasks = useTopologyStore((s) => s.connectTasks);
  const disconnectTasks = useTopologyStore((s) => s.disconnectTasks);
  const closeInspector = useTopologyStore((s) => s.closeInspector);

  const activeTask = operationalTasks.find((task) => task.id === selectedTaskId);
  const isOpen = isEditingDrawerOpen && !!activeTask;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity"
          onClick={closeInspector}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 w-104 transform border-l border-slate-700 bg-slate-900 shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {activeTask ? (
          <div className="flex h-full flex-col overflow-y-auto p-6 text-slate-300">
            <div className="mb-6 flex items-center justify-between border-b border-slate-700 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Edit Operational Task</h2>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">{activeTask.id}</p>
              </div>
              <button
                type="button"
                onClick={closeInspector}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-5">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Task Name</span>
                <input
                  value={activeTask.title}
                  onChange={(e) => updateTask(activeTask.id, { title: e.target.value })}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Zone</span>
                <select
                  value={activeTask.zone}
                  onChange={(e) =>
                    updateTask(activeTask.id, {
                      zone: e.target.value as (typeof OPERATIONAL_ZONES)[number],
                    })
                  }
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                >
                  {OPERATIONAL_ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Node Type</span>
                <select
                  value={activeTask.nodeType ?? "standard"}
                  onChange={(e) =>
                    updateTask(activeTask.id, {
                      nodeType: e.target.value as (typeof OPERATIONAL_NODE_TYPES)[number],
                    })
                  }
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                >
                  {OPERATIONAL_NODE_TYPES.map((nodeType) => (
                    <option key={nodeType} value={nodeType}>
                      {nodeType}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Duration</span>
                <input
                  value={activeTask.duration}
                  onChange={(e) => updateTask(activeTask.id, { duration: e.target.value })}
                  placeholder="e.g. 1d, 4h"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Dependencies
                </span>
                <div className="flex flex-col gap-2">
                  {activeTask.dependencies.length === 0 ? (
                    <p className="rounded border border-dashed border-slate-700 px-3 py-2 text-[11px] text-slate-500">
                      No upstream tasks. Drag a handle on the canvas, or add one
                      below.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {activeTask.dependencies.map((depId) => {
                        const dep = operationalTasks.find((task) => task.id === depId);
                        return (
                          <li
                            key={depId}
                            className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm text-slate-100">
                                {dep?.title ?? depId}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                {depId}
                              </div>
                            </div>
                            <button
                              type="button"
                              title={`Remove ${depId}`}
                              onClick={() =>
                                disconnectTasks(depId, activeTask.id)
                              }
                              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-red-300"
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const sourceId = e.target.value;
                      if (sourceId) connectTasks(sourceId, activeTask.id);
                    }}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  >
                    <option value="">Add upstream dependency…</option>
                    {operationalTasks
                      .filter(
                        (task) =>
                          task.id !== activeTask.id &&
                          !activeTask.dependencies.includes(task.id)
                      )
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title} ({task.id})
                        </option>
                      ))}
                  </select>
                </div>
              </label>

              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Inputs required
                </span>
                <TagInput
                  values={activeTask.inputsRequired}
                  onChange={(inputsRequired) =>
                    updateTask(activeTask.id, { inputsRequired })
                  }
                  placeholder="e.g. Approved Quote"
                />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Outputs generated
                </span>
                <TagInput
                  values={activeTask.outputsGenerated}
                  onChange={(outputsGenerated) =>
                    updateTask(activeTask.id, { outputsGenerated })
                  }
                  placeholder="e.g. Katana MO"
                />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Digital triggers
                </span>
                <TagInput
                  values={activeTask.digitalTriggers}
                  onChange={(digitalTriggers) =>
                    updateTask(activeTask.id, { digitalTriggers })
                  }
                  placeholder="e.g. GHL Webhook: stage_changed"
                />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Tech stack
                </span>
                <TagInput
                  values={activeTask.techStack}
                  onChange={(techStack) => updateTask(activeTask.id, { techStack })}
                  placeholder="e.g. GHL, Katana, Stripe"
                />
              </div>
            </div>

            <div className="mt-auto flex gap-2 border-t border-slate-800 pt-5">
              <button
                type="button"
                onClick={closeInspector}
                className="flex-1 rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => deleteTask(activeTask.id)}
                className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-300 hover:bg-red-950/70"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
