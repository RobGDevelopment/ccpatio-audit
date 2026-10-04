"use client";

import React, { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ExternalLink,
} from "lucide-react";
import type { EcommerceListing, EcommerceRosterGap } from "../actions";
import EcommerceFilters, {
  applyEcommerceFilters,
  type EcommerceFilterState,
} from "./EcommerceFilters";
import EcommerceExpandedRow from "./EcommerceExpandedRow";

type SortKey = "name" | "sku" | "legacy" | "msrp";
type SortDir = "asc" | "desc";

const COLUMN_COUNT = 6; // chevron, name, canonical SKU, legacy SKU, MSRP, link

function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/$/, "") || u.host;
  } catch {
    return url;
  }
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={`py-3 px-4 ${className}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`flex items-center gap-1 uppercase text-[11px] font-semibold tracking-wider transition-colors ${
          active ? "text-sky-700" : "text-slate-400 hover:text-slate-600"
        }`}
      >
        {label}
        {active &&
          (sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`text-lg font-bold ${
          warn && value > 0 ? "text-amber-600" : "text-slate-800"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

export default function EcommerceGrid({
  listings,
  gaps,
  onSaveMsrp,
}: {
  listings: EcommerceListing[];
  gaps: EcommerceRosterGap[];
  /** Persists a steel MSRP edit for a listing id (parent calls updateListingMsrp + updates state). */
  onSaveMsrp: (listingId: string, rawPrice: string) => Promise<void>;
}) {
  const [filters, setFilters] = useState<EcommerceFilterState>({
    search: "",
    collections: new Set(),
    types: new Set(),
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "name",
    dir: "asc",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null); // one at a time

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const filtered = applyEcommerceFilters(listings, filters);
    const dir = sort.dir === "asc" ? 1 : -1;
    const str = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * dir;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return str(a.productName, b.productName);
        case "sku":
          return str(a.globalSku, b.globalSku);
        case "legacy": {
          // Null legacy SKUs always sort last, regardless of direction.
          if (!a.legacyBaseSku && !b.legacyBaseSku) return 0;
          if (!a.legacyBaseSku) return 1;
          if (!b.legacyBaseSku) return -1;
          return str(a.legacyBaseSku, b.legacyBaseSku);
        }
        case "msrp":
          return (a.msrpValue - b.msrpValue) * dir; // numeric parse, not string
      }
    });
  }, [listings, filters, sort]);

  const missingLinks = listings.filter((l) => l.urlSource === "missing").length;
  const missingLegacy = listings.filter((l) => !l.legacyBaseSku).length;

  function handleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  async function save(id: string) {
    if (!editPrice.trim()) {
      setEditingId(null);
      return;
    }
    setSavingId(id);
    try {
      await onSaveMsrp(id, editPrice);
      setJustSavedId(id);
      setTimeout(() => setJustSavedId(null), 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
      setEditingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header: stats + filters */}
      <div className="p-5 border-b border-slate-100 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <Stat label="in roster" value={listings.length} />
          <Stat label="hub gaps" value={gaps.length} warn />
          <Stat label="missing links" value={missingLinks} warn />
          <Stat label="missing legacy SKU" value={missingLegacy} warn />
          <span className="ml-auto text-xs text-slate-400">
            Showing {rows.length} of {listings.length}
          </span>
        </div>
        <EcommerceFilters listings={listings} filters={filters} onChange={setFilters} />
      </div>

      {/* Scroll container with sticky header */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-100">
            <tr>
              <th className="py-3 px-4 w-10" aria-label="Expand" />
              <SortHeader label="Product Name" k="name" sort={sort} onSort={handleSort} />
              <SortHeader
                label="Canonical Hub SKU"
                k="sku"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader label="Legacy SKU" k="legacy" sort={sort} onSort={handleSort} />
              <SortHeader
                label="MSRP"
                k="msrp"
                sort={sort}
                onSort={handleSort}
                className="w-36"
              />
              <th className="py-3 px-4 uppercase text-[11px] font-semibold tracking-wider text-slate-400">
                Product Link
              </th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="py-16 text-center text-slate-400">
                  No listings match these filters.
                </td>
              </tr>
            )}
            {rows.map((l) => {
              const open = expandedId === l.id;
              const flash = justSavedId === l.id;
              return (
                <React.Fragment key={l.id}>
                  <tr
                    className={`border-b border-slate-100 transition-colors ${
                      flash ? "bg-emerald-50" : open ? "bg-sky-50/40" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : l.id)}
                        aria-expanded={open}
                        aria-label={open ? "Collapse row" : "Expand row"}
                        className="text-slate-400 hover:text-sky-600 transition-colors"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-4 font-medium text-slate-800">
                      {l.productName}
                    </td>

                    <td className="py-3 px-4 text-xs">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-slate-600">{l.globalSku}</span>
                        {l.canonicalSkuShared && (
                          <span
                            title="Another listing uses this canonical hub SKU"
                            className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
                          >
                            shared
                          </span>
                        )}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-xs">
                      {l.legacyBaseSku ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-slate-500">
                            {l.legacyBaseSku}
                          </span>
                          {l.legacySkuShared && (
                            <span
                              title="Another canonical SKU uses this legacy base SKU"
                              className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
                            >
                              shared
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {editingId === l.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") save(l.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-24 px-2 py-1 bg-white border border-sky-400 rounded-md text-sm font-semibold text-slate-800 focus:outline-none ring-2 ring-sky-500/20"
                          />
                          <button
                            type="button"
                            onClick={() => save(l.id)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            aria-label="Save price"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            setEditingId(l.id);
                            setEditPrice(l.msrp);
                          }}
                          className="cursor-pointer hover:underline font-semibold text-slate-700 hover:text-sky-700"
                          title="Click to edit steel MSRP"
                        >
                          {savingId === l.id ? "Saving..." : l.msrp}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-xs">
                      {l.productUrl ? (
                        <span className="inline-flex items-center gap-2">
                          <a
                            href={l.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                          >
                            {linkLabel(l.productUrl)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {l.urlSource === "sibling" && (
                            <span className="text-[10px] text-slate-400">shared page</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                  {open && <EcommerceExpandedRow listing={l} colSpan={COLUMN_COUNT} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
