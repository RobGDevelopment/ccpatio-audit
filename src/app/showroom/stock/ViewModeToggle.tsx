"use client";

import { ChevronsUpDown, GalleryHorizontal, LayoutGrid, type LucideIcon } from "lucide-react";

export type ViewMode = "grid" | "carousel" | "dropdown";

const MODES: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "carousel", label: "Carousel", icon: GalleryHorizontal },
  { id: "dropdown", label: "Dropdown", icon: ChevronsUpDown },
];

const floatShell =
  "inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-all duration-300 ease-out hover:shadow-[0_8px_20px_-3px_rgba(6,81,237,0.15)] hover:-translate-y-0.5";

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
      className={floatShell}
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
            className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-3 py-1.5 text-xs tracking-wide transition-all duration-300 ease-out ${
              selected
                ? "bg-slate-900 text-white shadow-[0_2px_10px_-3px_rgba(6,81,237,0.2)]"
                : "text-slate-500 hover:-translate-y-0.5 hover:text-slate-900"
            }`}
            onClick={() => onChange(mode.id)}
          >
            {selected ? (
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden="true">
                <span className="animate-beam-glide absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
              </span>
            ) : null}
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
