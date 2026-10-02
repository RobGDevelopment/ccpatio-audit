"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  availableTone,
  formatQty,
  type StockPrefix,
  type StockRow,
  type StockTone,
} from "@/lib/stock-display";
import { searchStock } from "./actions";

const FILTERS: { label: string; prefix: StockPrefix }[] = [
  { label: "All Fabrics", prefix: "FAB-" },
  { label: "All Dekton", prefix: "STN-DKT-" },
  { label: "All Firepits", prefix: "FRP-" },
];

const TONE_CLASS: Record<StockTone, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
};

export function StockChecker({
  token,
  initialQuery,
  initialRows,
  initialError,
}: {
  token: string;
  initialQuery: string;
  initialRows: StockRow[];
  initialError: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState(initialError);
  const [searched, setSearched] = useState(initialQuery.length > 0);
  const [activePrefix, setActivePrefix] = useState<StockPrefix | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch(next: { query?: string; prefix?: StockPrefix }) {
    setError(null);
    setActivePrefix(next.prefix ?? null);
    startTransition(async () => {
      const result = await searchStock({
        token,
        query: next.query,
        prefix: next.prefix,
      });
      setSearched(true);
      if (!result.ok) {
        setRows([]);
        setError(result.error);
        return;
      }
      setRows(result.rows);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch({ query: query.trim() });
  }

  function clearResults() {
    setQuery("");
    setRows([]);
    setError(null);
    setSearched(false);
    setActivePrefix(null);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-white px-2 py-3 text-zinc-900">
      <header className="mb-2 px-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          CC Patio
        </p>
        <h1 className="text-lg font-semibold tracking-tight">Stock checker</h1>
      </header>

      <form onSubmit={onSubmit} className="flex gap-2 px-1">
        <label className="sr-only" htmlFor="stock-query">
          SKU or name
        </label>
        <input
          id="stock-query"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or SKU"
          autoComplete="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-base outline-none focus:border-emerald-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "…" : "Search"}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5 px-1">
        {FILTERS.map((filter) => {
          const active = activePrefix === filter.prefix;
          return (
            <button
              key={filter.prefix}
              type="button"
              disabled={pending}
              onClick={() => runSearch({ prefix: filter.prefix })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
                active
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={clearResults}
          className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500"
        >
          Clear
        </button>
      </div>

      {error ? <p className="mt-3 px-1 text-sm text-rose-700">{error}</p> : null}

      {searched && !error && rows.length === 0 ? (
        <p className="mt-3 px-1 text-sm text-zinc-500">No matching SKUs.</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <p className="px-1 pb-1 text-[11px] text-zinc-500">{rows.length} items</p>
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-1 py-1 font-medium">Product</th>
                <th className="px-1 py-1 text-right font-medium">In stock</th>
                <th className="px-1 py-1 text-right font-medium">Committed</th>
                <th className="px-1 py-1 text-right font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku} className="border-b border-zinc-100 align-top">
                  <td className="px-1 py-1.5">
                    <p className="text-sm font-medium leading-snug">{row.name}</p>
                    {row.variantLabel ? (
                      <p className="break-words line-clamp-3 text-xs text-slate-600">{row.variantLabel}</p>
                    ) : null}
                    <p className="font-mono text-[11px] text-zinc-500">{row.sku}</p>
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatQty(row.inStock)}
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatQty(row.committed)}
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${TONE_CLASS[availableTone(row.available)]}`}
                    >
                      {formatQty(row.available)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
