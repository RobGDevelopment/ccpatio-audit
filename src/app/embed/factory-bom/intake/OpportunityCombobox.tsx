"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, AlertCircle, Building2, User } from "lucide-react";
import type { OpportunityHit } from "@/server/ghl/search-opportunities";

interface OpportunityComboboxProps {
  value?: OpportunityHit | null;
  onChange: (opp: OpportunityHit | null) => void;
  disabled?: boolean;
}

const cache = new Map<string, { timestamp: number; results: OpportunityHit[] }>();
const CACHE_TTL_MS = 30_000;

export function OpportunityCombobox({
  value,
  onChange,
  disabled = false,
}: OpportunityComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OpportunityHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Check cache
    const cached = cache.get(trimmed);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setResults(cached.results);
      setError(null);
      setLoading(false);
      return;
    }

    // Abort in-flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/embed/factory-bom/api/opportunities?q=${encodeURIComponent(trimmed)}`,
        { signal: ac.signal }
      );

      if (!res.ok) {
        if (res.status === 503) {
          setError("GoHighLevel is busy. Try again in a moment.");
        } else {
          setError("Could not load client projects.");
        }
        setResults([]);
        return;
      }

      const json = await res.json();
      if (json.ok && Array.isArray(json.results)) {
        setResults(json.results);
        cache.set(trimmed, { timestamp: Date.now(), results: json.results });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError("Search request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search trigger
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      search(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, isOpen, search]);

  const formatCurrency = (cents: number | null): string => {
    if (cents === null || !Number.isFinite(cents)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const handleSelect = (opp: OpportunityHit) => {
    onChange(opp);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full space-y-1.5">
      <label
        htmlFor="f_opp_combobox"
        className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
      >
        Find client project
      </label>

      {value ? (
        <div className="flex items-center justify-between p-3.5 bg-white/90 dark:bg-stone-900/90 backdrop-blur-md rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {value.name}
                </span>
                <span className="text-xs text-stone-400 font-mono">
                  {formatCurrency(value.valueCents)}
                </span>
              </div>
              <p className="text-xs text-stone-500 flex items-center mt-0.5">
                <User className="w-3 h-3 mr-1 opacity-70" />
                {value.contactName}
              </p>
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline px-2 py-1"
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <input
              id="f_opp_combobox"
              name="f_opp_combobox"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls="f_opp_listbox"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              disabled={disabled}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search by client or project name…"
              className="w-full h-11 pl-10 pr-9 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 transition"
            />
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3.5 pointer-events-none" />
            {loading && (
              <Loader2 className="w-4 h-4 text-amber-500 animate-spin absolute right-3.5 top-3.5 pointer-events-none" />
            )}
          </div>

          {isOpen && (
            <ul
              id="f_opp_listbox"
              role="listbox"
              className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white/95 dark:bg-stone-900/95 backdrop-blur-md rounded-xl border border-stone-200 dark:border-stone-800 shadow-lg divide-y divide-stone-100 dark:divide-stone-800"
            >
              {loading && results.length === 0 && (
                <li className="p-3 text-center text-xs text-stone-400 flex items-center justify-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  <span>Searching client projects…</span>
                </li>
              )}

              {error && (
                <li className="p-3 text-xs text-rose-600 dark:text-rose-400 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </li>
              )}

              {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
                <li className="p-4 text-center text-xs text-stone-400">
                  No matching client projects found in GoHighLevel.
                </li>
              )}

              {!loading && query.trim().length < 2 && (
                <li className="p-3 text-center text-xs text-stone-400">
                  Type at least 2 characters to search…
                </li>
              )}

              {results.map((opp, idx) => (
                <li
                  key={opp.id}
                  role="option"
                  aria-selected={idx === activeIndex}
                  onClick={() => handleSelect(opp)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`p-3 cursor-pointer text-xs transition flex items-center justify-between ${
                    idx === activeIndex
                      ? "bg-amber-500/10 text-stone-900 dark:text-stone-100"
                      : "hover:bg-stone-50 dark:hover:bg-stone-800/50 text-stone-800 dark:text-stone-200"
                  }`}
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-sm">{opp.name}</p>
                    <p className="text-stone-500 flex items-center">
                      <User className="w-3 h-3 mr-1 opacity-70" />
                      {opp.contactName}
                    </p>
                  </div>
                  <span className="font-mono text-stone-500 text-xs shrink-0 pl-3">
                    {formatCurrency(opp.valueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
