"use client";

export type ViewMode = "grid" | "carousel" | "dropdown";

const MODES: { id: ViewMode; label: string; glyph: string }[] = [
  { id: "grid", label: "Grid", glyph: "::" },
  { id: "carousel", label: "Carousel", glyph: "=" },
  { id: "dropdown", label: "Dropdown", glyph: "v" },
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
      className="inline-flex rounded-full bg-white p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
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
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${mode.label} layout`}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs tracking-wide transition-colors ${
              selected ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
            }`}
            onClick={() => onChange(mode.id)}
          >
            <span aria-hidden="true" className="font-mono text-[11px] leading-none">
              {mode.glyph}
            </span>
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
