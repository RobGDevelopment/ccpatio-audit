"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  LEAD_SCENARIO_OPTIONS,
  type LeadScenarioId,
} from "./topology-scenarios";
import { useModalA11y } from "@/app/admin/shared/useModalA11y";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (scenarioId: LeadScenarioId) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export function ScenarioSelectorModal({
  open,
  onClose,
  onSelect,
  returnFocusRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useModalA11y({
    open,
    onClose,
    containerRef: panelRef,
    returnFocusRef,
  });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[250] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close scenario selector"
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scenario-selector-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/95 shadow-2xl shadow-black/60 outline-none"
      >
        <header className="border-b border-slate-800/90 px-6 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-500/90">
            Scenario engine
          </p>
          <h2
            id="scenario-selector-title"
            className="mt-1 text-lg font-semibold text-slate-50"
          >
            Where did this buyer enter?
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Pick a lead source to simulate one conditional journey through sales,
            GHL automation, and manufacturing — not a brute-force edge trace.
          </p>
        </header>

        <ul className="space-y-2 px-4 py-4">
          {LEAD_SCENARIO_OPTIONS.map((scenario, index) => (
            <li key={scenario.id}>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.06 }}
                onClick={() => onSelect(scenario.id)}
                className="group flex w-full flex-col rounded-lg border border-slate-800/90 bg-slate-900/40 px-4 py-3.5 text-left transition hover:border-cyan-500/40 hover:bg-slate-900/80"
              >
                <span
                  className="text-sm font-semibold text-slate-100"
                  style={{ color: scenario.accent }}
                >
                  {scenario.label}
                </span>
                <span className="mt-1 text-[12px] leading-relaxed text-slate-500 group-hover:text-slate-400">
                  {scenario.description}
                </span>
              </motion.button>
            </li>
          ))}
        </ul>

        <footer className="border-t border-slate-800/90 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-slate-500 transition hover:text-slate-300"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
