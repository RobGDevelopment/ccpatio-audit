"use client";

import { ChevronsUpDown, GalleryHorizontal, LayoutGrid, type LucideIcon } from "lucide-react";

export type ViewMode = "grid" | "carousel" | "dropdown";

const MODES: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: "dropdown", label: "Dropdown", icon: ChevronsUpDown },
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "carousel", label: "Carousel", icon: GalleryHorizontal },
];

export function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  function move(direction: -1 | 1) {
    const index = MODES.findIndex((mode) => mode.id === viewMode);
    const next = MODES[(index + direction + MODES.length) % MODES.length];
    if (next) onChange(next.id);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Filter layout"
      className="inline-flex items-end gap-1"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {MODES.map((mode) => {
        const selected = viewMode === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${mode.label} layout`}
            className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs tracking-wide transition-all duration-150 ease-out ${
              selected
                ? "translate-y-0.5 bg-slate-50 text-slate-900 shadow-inner"
                : "border-b-2 border-slate-200 bg-white text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => onChange(mode.id)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
