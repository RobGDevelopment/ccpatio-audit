"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { searchRawMaterials, type RawMaterialRow } from "@/app/admin/raw-materials/actions";

type RawMaterialComboboxProps = {
  value: string;
  onChange: (sku: string, material?: RawMaterialRow) => void;
  disabled?: boolean;
  placeholder?: string;
};

const INPUT_CLASS =
  "w-full border-b border-transparent bg-transparent py-1.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors hover:border-zinc-700 focus:border-emerald-500";

export function RawMaterialCombobox({
  value,
  onChange,
  disabled = false,
  placeholder = "Search raw materials…",
}: RawMaterialComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RawMaterialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchRawMaterials(query);
        if (!cancelled) {
          setOptions(rows);
          setHighlightIndex(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const visibleOptions = useMemo(() => options.slice(0, 12), [options]);

  function selectOption(option: RawMaterialRow): void {
    onChange(option.sku, option);
    setQuery(option.sku);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        Math.min(prev + 1, Math.max(visibleOptions.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter" && visibleOptions[highlightIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[highlightIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={INPUT_CLASS}
        disabled={disabled}
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-zinc-700/80 bg-zinc-950 py-1 shadow-2xl"
        >
          {loading ? (
            <p className="px-3 py-2 text-xs text-zinc-500">Searching…</p>
          ) : visibleOptions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">
              No materials found. Add one in{" "}
              <a
                href="/admin/raw-materials"
                className="text-emerald-400/90 hover:text-emerald-300"
              >
                Raw Materials
              </a>
              .
            </p>
          ) : (
            visibleOptions.map((option, index) => (
              <button
                key={option.sku}
                type="button"
                role="option"
                aria-selected={index === highlightIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left transition ${
                  index === highlightIndex
                    ? "bg-emerald-500/10 text-emerald-100"
                    : "text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <span className="font-mono text-[13px]">{option.sku}</span>
                <span className="text-[11px] text-zinc-500">
                  {option.name} · {option.category} · {option.unitOfMeasure}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
