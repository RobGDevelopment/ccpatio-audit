"use client";

import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { field, pillActive, pillBase, pillIdle } from "../showroom-ui";
import type { ViewMode } from "./ViewModeToggle";

function fuzzyScore(name: string, query: string): number | null {
  const haystack = name.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  if (haystack.startsWith(needle)) return 0;
  const index = haystack.indexOf(needle);
  if (index >= 0) return 1 + index;
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return 100;
  }
  return null;
}

function FacetCombobox({
  options,
  value,
  placeholder,
  onSelect,
  onClear,
}: {
  options: string[];
  value: string | null;
  placeholder: string;
  onSelect: (name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");

  function revealOptions(input: HTMLInputElement) {
    if (input.getAttribute("aria-expanded") === "true") return;
    const button = input.parentElement?.querySelector("button[aria-label='Show options']");
    if (!(button instanceof HTMLButtonElement)) return;
    button.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  }
  const filtered = useMemo(() => {
    return options
      .map((name) => ({ name, score: fuzzyScore(name, query) }))
      .filter((item): item is { name: string; score: number } => item.score !== null)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .map((item) => item.name);
  }, [options, query]);

  return (
    <Combobox
      immediate
      value={value}
      onChange={(next: string | null) => {
        if (next) onSelect(next);
      }}
      onClose={() => setQuery("")}
    >
      <div className="relative max-w-lg">
        <ComboboxInput
          className={`${field} bg-white pr-16`}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
          displayValue={(item: string | null) => item ?? ""}
          onChange={(event) => setQuery(event.target.value)}
          onMouseDown={(event) => revealOptions(event.currentTarget)}
          onFocus={(event) => {
            const input = event.currentTarget;
            requestAnimationFrame(() => revealOptions(input));
          }}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center">
          {value ? (
            <button
              type="button"
              aria-label={`Clear ${value}`}
              className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClear}
            >
              <ClearIcon />
            </button>
          ) : null}
          <ComboboxButton
            aria-label="Show options"
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:text-slate-900"
          >
            <ChevronUpDownIcon />
          </ComboboxButton>
        </div>
      </div>
      <ComboboxOptions
        anchor="bottom start"
        portal
        className="z-50 mt-2 max-h-64 w-[var(--input-width)] overflow-y-auto rounded-2xl bg-white p-2 shadow-lg [--anchor-max-height:16rem] empty:hidden"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-400">No matches</p>
        ) : (
          filtered.map((name) => (
            <ComboboxOption
              key={name}
              value={name}
              className="cursor-pointer rounded-xl px-3 py-2 text-sm text-slate-700 data-focus:bg-slate-100 data-selected:bg-slate-900 data-selected:text-white"
            >
              {name}
            </ComboboxOption>
          ))
        )}
      </ComboboxOptions>
    </Combobox>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M15.75 19.5 8.25 12l7.5-7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="m8.25 4.5 7.5 7.5-7.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarouselRail({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  function pan(direction: -1 | 1) {
    containerRef.current?.scrollBy({ left: direction * 300, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-14 items-center bg-gradient-to-r from-slate-50 to-transparent">
        <button
          type="button"
          aria-label="Scroll left"
          className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:text-slate-900"
          onClick={() => pan(-1)}
        >
          <ChevronLeftIcon />
        </button>
      </div>
      <div
        ref={containerRef}
        className="showroom-carousel flex flex-row flex-nowrap items-center gap-2 overflow-x-auto px-10 py-1 whitespace-nowrap overscroll-x-contain"
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-14 items-center justify-end bg-gradient-to-l from-slate-50 to-transparent">
        <button
          type="button"
          aria-label="Scroll right"
          className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:text-slate-900"
          onClick={() => pan(1)}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </div>
  );
}

function chooseName(
  name: string,
  value: string | null,
  toggleActive: boolean,
  onSelect: (name: string) => void,
  onClear: () => void,
) {
  if (toggleActive && value === name) onClear();
  else onSelect(name);
}

function PillRow({
  names,
  value,
  collapsed,
  clearActive,
  toggleActive,
  onSelect,
  onClear,
}: {
  names: string[];
  value: string | null;
  collapsed: boolean;
  clearActive: boolean;
  toggleActive: boolean;
  onSelect: (name: string) => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {names.map((name) => {
        const active = value === name;
        const showClear = collapsed || (clearActive && active);
        return (
          <motion.div
            layout
            key={name}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.18 }}
            className={
              showClear
                ? `${pillBase} ${pillActive} inline-flex shrink-0 items-center gap-1 py-1 pr-1 pl-4 whitespace-nowrap`
                : "inline-flex shrink-0"
            }
          >
            {showClear ? (
              <>
                {collapsed ? (
                  <span>{name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => chooseName(name, value, toggleActive, onSelect, onClear)}
                  >
                    {name}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Clear ${name}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                  onClick={onClear}
                >
                  <ClearIcon />
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`${pillBase} whitespace-nowrap ${active ? pillActive : pillIdle}`}
                onClick={() => chooseName(name, value, toggleActive, onSelect, onClear)}
              >
                {name}
              </button>
            )}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

export function FacetPicker({
  viewMode,
  options,
  value,
  placeholder,
  toggleActive = false,
  onSelect,
  onClear,
}: {
  viewMode: ViewMode;
  options: string[];
  value: string | null;
  placeholder: string;
  toggleActive?: boolean;
  onSelect: (name: string) => void;
  onClear: () => void;
}) {
  const collapsed = viewMode === "grid" && value != null;
  const visible: string[] = viewMode === "grid" && value != null ? [value] : options;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {viewMode === "dropdown" ? (
        <motion.div
          key="dropdown"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18 }}
        >
          <FacetCombobox
            options={options}
            value={value}
            placeholder={placeholder}
            onSelect={onSelect}
            onClear={onClear}
          />
        </motion.div>
      ) : (
        <motion.div
          key={viewMode}
          layout
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18 }}
          className={viewMode === "grid" ? "relative flex flex-wrap gap-2" : undefined}
        >
          {viewMode === "carousel" ? (
            <CarouselRail>
              <PillRow
                names={visible}
                value={value}
                collapsed={false}
                clearActive
                toggleActive={toggleActive}
                onSelect={onSelect}
                onClear={onClear}
              />
            </CarouselRail>
          ) : (
            <PillRow
              names={visible}
              value={value}
              collapsed={collapsed}
              clearActive={false}
              toggleActive={toggleActive}
              onSelect={onSelect}
              onClear={onClear}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
