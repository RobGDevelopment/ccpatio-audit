"use client";

import React from "react";
import { Search, X } from "lucide-react";
import type { EcommerceListing } from "../actions";

export interface EcommerceFilterState {
  search: string;
  collections: Set<string>;
  types: Set<string>;
}

/** Search match: product name, canonical SKU, legacy SKU. */
export function matchesSearch(l: EcommerceListing, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    l.productName.toLowerCase().includes(q) ||
    l.globalSku.toLowerCase().includes(q) ||
    (l.legacyBaseSku ?? "").toLowerCase().includes(q)
  );
}

/** Applies search + both facets. */
export function applyEcommerceFilters(
  listings: EcommerceListing[],
  f: EcommerceFilterState,
): EcommerceListing[] {
  return listings.filter(
    (l) =>
      matchesSearch(l, f.search) &&
      (f.collections.size === 0 || f.collections.has(l.collectionLabel)) &&
      (f.types.size === 0 || f.types.has(l.drawingSection)),
  );
}

function countBy(
  items: EcommerceListing[],
  pick: (l: EcommerceListing) => string,
): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(pick(i), (m.get(pick(i)) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: [string, number][];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="shrink-0 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-24">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([label, count]) => {
          const on = selected.has(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => onToggle(label)}
              aria-pressed={on}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                on
                  ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-700"
              } ${count === 0 && !on ? "opacity-40" : ""}`}
            >
              {label}
              <span className={`ml-1.5 ${on ? "text-sky-100" : "text-slate-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function EcommerceFilters({
  listings,
  filters,
  onChange,
}: {
  listings: EcommerceListing[];
  filters: EcommerceFilterState;
  onChange: (next: EcommerceFilterState) => void;
}) {
  // Counts reflect the search box, then the OTHER facet.
  const searched = listings.filter((l) => matchesSearch(l, filters.search));

  const forCollections = searched.filter(
    (l) => filters.types.size === 0 || filters.types.has(l.drawingSection),
  );
  const forTypes = searched.filter(
    (l) =>
      filters.collections.size === 0 || filters.collections.has(l.collectionLabel),
  );

  // Keep selected-but-now-empty options visible so they can be unselected.
  const withSelected = (
    counted: [string, number][],
    selected: Set<string>,
  ): [string, number][] => {
    const have = new Set(counted.map(([k]) => k));
    const extra = [...selected].filter((k) => !have.has(k)).map((k) => [k, 0] as [string, number]);
    return [...counted, ...extra].sort((a, b) => a[0].localeCompare(b[0]));
  };

  // Option universe = everything in the roster, so zero-count options stay visible (dimmed).
  const allCollections = [...new Set(listings.map((l) => l.collectionLabel))];
  const allTypes = [...new Set(listings.map((l) => l.drawingSection))];
  const collCounts = new Map(countBy(forCollections, (l) => l.collectionLabel));
  const typeCounts = new Map(countBy(forTypes, (l) => l.drawingSection));
  const collectionOptions = withSelected(
    allCollections.map((c) => [c, collCounts.get(c) ?? 0] as [string, number]),
    filters.collections,
  );
  const typeOptions = withSelected(
    allTypes.map((t) => [t, typeCounts.get(t) ?? 0] as [string, number]),
    filters.types,
  );

  const hasActive =
    filters.search !== "" || filters.collections.size > 0 || filters.types.size > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Search name, canonical SKU, or legacy SKU..."
            aria-label="Search E-Commerce roster"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all placeholder:text-slate-400"
          />
        </div>
        {hasActive && (
          <button
            type="button"
            onClick={() =>
              onChange({ search: "", collections: new Set(), types: new Set() })
            }
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-sky-700"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>
      <FacetGroup
        title="Collection"
        options={collectionOptions}
        selected={filters.collections}
        onToggle={(v) =>
          onChange({ ...filters, collections: toggle(filters.collections, v) })
        }
      />
      <FacetGroup
        title="Product Type"
        options={typeOptions}
        selected={filters.types}
        onToggle={(v) => onChange({ ...filters, types: toggle(filters.types, v) })}
      />
    </div>
  );
}
