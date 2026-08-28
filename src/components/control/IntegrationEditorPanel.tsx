"use client";

import type { Node } from "@xyflow/react";
import { useTopologyStore } from "../topology/topologyStore";
import {
  INTEGRATION_SYSTEMS,
  TRIGGER_TYPES,
  type ExecutionState,
  type IntegrationSystem,
  type TriggerType,
} from "../../schema/nodeIntegrationConfig";

export function IntegrationEditorPanel() {
  const selectedIntegrationNodeId = useTopologyStore(
    (s) => s.selectedIntegrationNodeId
  );
  const isIntegrationEditorOpen = useTopologyStore(
    (s) => s.isIntegrationEditorOpen
  );
  const config = useTopologyStore((s) =>
    selectedIntegrationNodeId
      ? s.nodeIntegrationConfigs[selectedIntegrationNodeId]
      : undefined
  );
  const graphNodes = useTopologyStore((s) => s.graphNodes);
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const updateNodeIntegration = useTopologyStore((s) => s.updateNodeIntegration);
  const closeIntegrationEditor = useTopologyStore((s) => s.closeIntegrationEditor);
  const startTrace = useTopologyStore((s) => s.startTrace);
  const selectTask = useTopologyStore((s) => s.selectTask);

  const isOpen = isIntegrationEditorOpen && !!selectedIntegrationNodeId && !!config;
  const selectedNode = graphNodes.find((n) => n.id === selectedIntegrationNodeId);
  const isOperational = operationalTasks.some(
    (task) => task.id === selectedIntegrationNodeId
  );

  const patch = (updates: Parameters<typeof updateNodeIntegration>[1]) => {
    if (!selectedIntegrationNodeId) return;
    updateNodeIntegration(selectedIntegrationNodeId, updates);
  };

  const handleTrace = () => {
    if (!selectedIntegrationNodeId || !selectedNode) return;
    if (selectedNode.type === "stage") {
      const parentId = (selectedNode.data as { parentPipelineId?: string })
        .parentPipelineId;
      if (parentId) startTrace(parentId);
      return;
    }
    startTrace(selectedIntegrationNodeId);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity"
          onClick={closeIntegrationEditor}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 w-[28rem] transform border-l border-slate-700/80 bg-slate-950 shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {config && selectedIntegrationNodeId ? (
          <div className="flex h-full flex-col overflow-y-auto text-slate-300">
            <div className="border-b border-slate-800 bg-slate-900/80 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400">
                    Integration Editor
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-100">
                    Control Plane
                  </h2>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {selectedIntegrationNodeId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeIntegrationEditor}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  aria-label="Close editor"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-6 px-6 py-5">
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Stage Details
                </h3>
                <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      Node Title
                    </span>
                    <input
                      value={config.nodeTitle}
                      onChange={(e) => patch({ nodeTitle: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      Pipeline Name
                    </span>
                    <input
                      value={config.pipelineName}
                      onChange={(e) => patch({ pipelineName: e.target.value })}
                      placeholder="e.g. Scottsdale | Sales (AZ)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      System
                    </span>
                    <select
                      value={config.system}
                      onChange={(e) =>
                        patch({ system: e.target.value as IntegrationSystem })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70"
                    >
                      {INTEGRATION_SYSTEMS.map((system) => (
                        <option key={system} value={system}>
                          {system}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Execution State
                </h3>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-2">
                  {(
                    [
                      {
                        value: "manual" as ExecutionState,
                        label: "Manual / Human",
                        icon: "✋",
                        hint: "Human trigger required",
                      },
                      {
                        value: "automated" as ExecutionState,
                        label: "Automated / System",
                        icon: "⚡",
                        hint: "Middleware handles handoff",
                      },
                    ] as const
                  ).map((option) => {
                    const active = config.executionState === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => patch({ executionState: option.value })}
                        className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? option.value === "automated"
                              ? "border-amber-400/50 bg-amber-500/10 text-amber-100"
                              : "border-orange-400/50 bg-orange-500/10 text-orange-100"
                            : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                        }`}
                      >
                        <div className="text-lg">{option.icon}</div>
                        <div className="mt-1 text-xs font-semibold">
                          {option.label}
                        </div>
                        <div className="mt-0.5 text-[10px] opacity-70">
                          {option.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Trigger Configuration
                </h3>
                <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      Trigger Type
                    </span>
                    <select
                      value={config.triggerType}
                      onChange={(e) =>
                        patch({ triggerType: e.target.value as TriggerType })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70"
                    >
                      {TRIGGER_TYPES.map((trigger) => (
                        <option key={trigger.value} value={trigger.value}>
                          {trigger.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      Target API Route
                    </span>
                    <input
                      value={config.targetApiRoute}
                      onChange={(e) => patch({ targetApiRoute: e.target.value })}
                      placeholder="/api/webhooks/ghl"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-cyan-100 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30"
                    />
                  </label>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Lean Optimization Notes
                </h3>
                <textarea
                  value={config.leanNotes}
                  onChange={(e) => patch({ leanNotes: e.target.value })}
                  rows={5}
                  placeholder='e.g. "Stop typing finishes in notes — use Opportunity dropdowns aligned to Katana."'
                  className="w-full resize-y rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                />
              </section>
            </div>

            <div className="mt-auto flex flex-col gap-2 border-t border-slate-800 bg-slate-900/60 px-6 py-4">
              <button
                type="button"
                onClick={closeIntegrationEditor}
                className="w-full rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-3 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
              >
                Done
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTrace}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                >
                  Trace Downstream
                </button>
                {isOperational ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedIntegrationNodeId) {
                        closeIntegrationEditor();
                        selectTask(selectedIntegrationNodeId);
                      }
                    }}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    Task Editor
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function openIntegrationEditorForNode(node: Node): void {
  useTopologyStore.getState().openIntegrationEditor(node);
}
