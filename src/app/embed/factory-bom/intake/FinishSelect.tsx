"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, Check, AlertCircle } from "lucide-react";
import type { FinishChoice } from "@/lib/intake/types";
import type { FinishItem } from "@/server/factory-bom/intake/finishes";

interface FinishSelectProps {
  label: string;
  kind: "frame" | "powder" | "fabric";
  value?: FinishChoice;
  onChange: (choice: FinishChoice) => void;
  disabled?: boolean;
}

export function FinishSelect({
  label,
  kind,
  value,
  onChange,
  disabled = false,
}: FinishSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<FinishItem[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [tbdNote, setTbdNote] = useState(value?.kind === "tbd" ? value.note : "");

  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const tbdNoteRef = useRef(value?.kind === "tbd" ? value.note : "");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchItems = useCallback(async (q: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    setLoading(true);
    setLoadError(null);
    try {
      const url = `/embed/factory-bom/api/finishes?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) {
        throw new Error(`Failed to load finishes (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (!json.ok || !Array.isArray(json.results)) {
        throw new Error(json.message || "Invalid finishes response");
      }
      setItems(json.results);
      const cur = valueRef.current;
      if (cur?.kind === "sku") {
        const found = json.results.find((i: FinishItem) => i.sku === cur.sku);
        if (found) setSelectedName(found.name);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Failed to load finishes");
    } finally {
      if (abortControllerRef.current === ac) {
        setLoading(false);
      }
    }
  }, [kind]);

  useEffect(() => {
    fetchItems("");
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [kind, fetchItems]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchItems(q);
    }, 250);
  };

  const handleSelectSku = (item: FinishItem) => {
    setSelectedName(item.name);
    onChange({ kind: "sku", sku: item.sku });
    setIsOpen(false);
  };

  const handleSelectTbd = () => {
    setSelectedName("TBD / Pending");
    const initialNote = tbdNoteRef.current.trim();
    onChange({ kind: "tbd", note: initialNote });
    setIsOpen(false);
  };

  const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const note = e.target.value;
    tbdNoteRef.current = note;
    setTbdNote(note);
    onChange({ kind: "tbd", note });
  };

  const isTbd = value?.kind === "tbd";
  const inputId = `f_finish_${kind}`;

  return (
    <div ref={containerRef} className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
        >
          {label}
        </label>
        {isTbd && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
            Pending confirmation
          </span>
        )}
      </div>

      <div className="relative">
        <button
          id={inputId}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full h-11 px-3 text-left text-sm rounded-xl bg-white dark:bg-stone-900 border transition flex items-center justify-between ${
            isTbd
              ? "border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 bg-amber-50/20"
              : value?.kind === "sku"
              ? "border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100"
              : "border-stone-200 dark:border-stone-800 text-stone-400"
          } focus:outline-none focus:ring-2 focus:ring-amber-500`}
        >
          <span className="truncate">
            {value?.kind === "sku"
              ? selectedName || value.sku
              : isTbd
              ? "TBD / Pending"
              : `Select ${label.toLowerCase()}…`}
          </span>
          <span className="text-stone-400 text-xs">▼</span>
        </button>

        {isOpen && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white/95 dark:bg-stone-900/95 backdrop-blur-md rounded-xl border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden">
            <div className="p-2 border-b border-stone-100 dark:border-stone-800">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  onChange={handleQueryChange}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="w-full h-8 pl-7 pr-3 text-xs rounded-lg bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            <ul role="listbox" className="max-h-56 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
              {/* TBD Choice */}
              <li
                role="option"
                aria-selected={isTbd}
                onClick={handleSelectTbd}
                className="p-2.5 cursor-pointer text-xs flex items-center justify-between hover:bg-amber-50 dark:hover:bg-amber-950/20 text-amber-700 dark:text-amber-400 font-medium"
              >
                <span>TBD / Pending (add note)</span>
                {isTbd && <Check className="w-3.5 h-3.5 text-amber-600" />}
              </li>

              {loading && items.length === 0 && (
                <li className="p-4 text-center text-xs text-stone-400 flex items-center justify-center space-x-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  <span>Loading finishes…</span>
                </li>
              )}

              {loadError && (
                <li className="p-3 text-center text-xs text-rose-600 dark:text-rose-400 space-y-1 bg-rose-50/50 dark:bg-rose-950/20">
                  <p>{loadError}</p>
                  <button
                    type="button"
                    onClick={() => fetchItems(query)}
                    className="text-[11px] underline text-amber-600 hover:text-amber-700 font-medium"
                  >
                    Retry loading
                  </button>
                </li>
              )}

              {items.map((item) => {
                const isSelected = value?.kind === "sku" && value.sku === item.sku;
                return (
                  <li
                    key={item.sku}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectSku(item)}
                    className="p-2.5 cursor-pointer text-xs flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-800/60 text-stone-800 dark:text-stone-200"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-[10px] text-stone-400 font-mono">{item.sku}</p>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-amber-500" />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Note input if TBD is selected (OD3) */}
      {isTbd && (
        <div className="space-y-1 pt-1">
          <input
            type="text"
            value={tbdNote}
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            onChange={handleNoteChange}
            placeholder="Who will confirm, and by when? (Required)"
            className="w-full h-9 px-3 text-xs rounded-lg bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 text-stone-900 dark:text-stone-100 placeholder:text-amber-700/60 dark:placeholder:text-amber-400/60 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {tbdNote.trim().length < 5 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center space-x-1">
              <AlertCircle className="w-3 h-3" />
              <span>Note must be at least 5 characters</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
