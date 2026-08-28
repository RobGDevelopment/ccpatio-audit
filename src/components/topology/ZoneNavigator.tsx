"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  FOCUS_PRESETS,
  FOCUS_PRESET_LIST,
  type FocusPresetId,
} from "./focusPresets";
import { useTopologyStore } from "./topologyStore";

type Props = {
  compact?: boolean;
};

export function ZoneNavigator({ compact = false }: Props) {
  const rf = useReactFlow();
  const focusPresetId = useTopologyStore((s) => s.focusPresetId);
  const setFocusPresetId = useTopologyStore((s) => s.setFocusPresetId);

  const zoomToPreset = useCallback(
    (id: FocusPresetId) => {
      setFocusPresetId(id);
      if (id === "all") {
        void rf.fitView({ padding: 0.04, duration: 600, maxZoom: 1 });
        return;
      }
      const preset = FOCUS_PRESETS[id];
      void rf.fitView({
        nodes: preset.focusNodeIds.map((nid) => ({ id: nid })),
        padding: 0.12,
        duration: 650,
        maxZoom: 0.85,
      });
    },
    [rf, setFocusPresetId]
  );

  const storyPresets = FOCUS_PRESET_LIST.filter((id) => id !== "all");

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {storyPresets.map((id) => {
          const preset = FOCUS_PRESETS[id];
          const active = focusPresetId === id;
          return (
            <button
              key={id}
              type="button"
              title={preset.description}
              onClick={() => zoomToPreset(active ? "all" : id)}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                active
                  ? "border-violet-400/55 bg-violet-500/18 text-violet-100"
                  : "border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        {focusPresetId !== "all" ? (
          <button
            type="button"
            onClick={() => zoomToPreset("all")}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300"
          >
            Full Map
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
      {storyPresets.map((id) => {
        const preset = FOCUS_PRESETS[id];
        const active = focusPresetId === id;
        return (
          <button
            key={id}
            type="button"
            title={preset.description}
            onClick={() => zoomToPreset(active ? "all" : id)}
            className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              active
                ? "border-violet-400/55 bg-violet-500/18 text-violet-100"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            {preset.label}
          </button>
        );
      })}
      {focusPresetId !== "all" ? (
        <button
          type="button"
          onClick={() => zoomToPreset("all")}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300"
        >
          Full map
        </button>
      ) : null}
    </div>
  );
}
