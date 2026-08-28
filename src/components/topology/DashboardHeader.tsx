"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { JOURNEY_COLORS, type JourneyId } from "./sequences";
import { useTopologyStore } from "./topologyStore";
import type { WalkthroughId } from "./ghlPipelines";
import { WALKTHROUGH_OPTIONS } from "./ghlPipelines";

type Props = {
  progress: number;
  onPlay: () => void;
  onResetScenario?: () => void;
  scenarioActive?: boolean;
  onPause: () => void;
  onStepNext: () => void;
  onResetPlayback: () => void;
};

export function DashboardHeader({
  progress,
  onPlay,
  onResetScenario,
  scenarioActive = false,
  onPause,
  onStepNext,
  onResetPlayback,
}: Props) {
  const playbackState = useTopologyStore((s) => s.playbackState);
  const journeyId = useTopologyStore((s) => s.journeyId);
  const walkthroughId = useTopologyStore((s) => s.walkthroughId);
  const setWalkthrough = useTopologyStore((s) => s.setWalkthrough);
  const stepIndex = useTopologyStore((s) => s.stepIndex);
  const [menuOpen, setMenuOpen] = useState(false);

  const color = JOURNEY_COLORS[journeyId];
  const activeLabel =
    WALKTHROUGH_OPTIONS.find((o) => o.id === walkthroughId)?.label ??
    "Select scenario";

  const statusLabel =
    playbackState === "playing"
      ? "Playing"
      : playbackState === "paused"
        ? "Paused"
        : "Idle";

  const selectWalkthrough = (id: WalkthroughId) => {
    onResetPlayback();
    setWalkthrough(id);
    setMenuOpen(false);
  };

  return (
    <header className="pointer-events-auto relative z-30 shrink-0 border-b border-slate-800/90 bg-slate-950/92 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.28em] text-cyan-500/85">
            CCPATIO
          </div>
          <div className="truncate text-sm font-semibold text-slate-100">
            Operations Command Center
          </div>
          {walkthroughId ? (
            <div className="text-[10px] text-slate-500">
              Click a box to see where it maps Out · disconnect or add inputs
            </div>
          ) : null}
        </div>

        <div className="relative shrink-0">
          <motion.button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            data-roadmap-selector
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${
              walkthroughId
                ? "border-violet-500/45 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25"
                : "border-violet-400/70 bg-violet-500/25 text-violet-50 hover:bg-violet-500/35"
            }`}
            animate={
              walkthroughId
                ? undefined
                : {
                    boxShadow: [
                      "0 0 8px rgba(167,139,250,0.2)",
                      "0 0 22px rgba(167,139,250,0.55)",
                      "0 0 8px rgba(167,139,250,0.2)",
                    ],
                  }
            }
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            Roadmap Selector{walkthroughId ? ` · ${activeLabel}` : ""}
          </motion.button>
          {menuOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close roadmap menu"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="listbox"
                className="absolute right-0 top-full z-50 mt-1.5 min-w-[14rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 py-1 shadow-xl"
              >
                {WALKTHROUGH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={walkthroughId === opt.id}
                    onClick={() => selectWalkthrough(opt.id)}
                    className={`flex w-full flex-col px-3 py-2 text-left hover:bg-slate-900 ${
                      walkthroughId === opt.id
                        ? "bg-violet-500/15 text-violet-100"
                        : "text-slate-300"
                    }`}
                  >
                    <span className="text-[12px] font-medium">{opt.label}</span>
                    <span className="text-[10px] text-slate-500">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onPlay}
            disabled={playbackState === "playing"}
            className="rounded-lg border border-cyan-500/45 bg-cyan-500/12 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/22 disabled:opacity-40"
            title="Run buyer journey scenario"
          >
            Play
          </button>
          {scenarioActive && onResetScenario ? (
            <button
              type="button"
              onClick={onResetScenario}
              className="rounded-lg border border-red-500/45 bg-red-500/12 px-3 py-1.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/22"
              title="Stop scenario and clear active lines"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={onPause}
            disabled={
              !walkthroughId ||
              (playbackState !== "playing" && playbackState !== "paused")
            }
            className="rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {playbackState === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={onStepNext}
            disabled={!walkthroughId}
            title="Step forward"
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 disabled:opacity-40"
          >
            Step
          </button>
        </div>

        <div className="flex min-w-[8rem] items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {statusLabel}
          </span>
          <div className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              className="h-full rounded-full"
              style={{ background: color }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
          <span
            className="font-[family-name:var(--font-plex-mono)] text-[10px] tabular-nums text-slate-400"
            style={{ color }}
          >
            {stepIndex + 1}
          </span>
        </div>
      </div>
    </header>
  );
}

/** Kept for type compat with older call sites that passed JourneyId via walkthrough. */
export type { JourneyId };
