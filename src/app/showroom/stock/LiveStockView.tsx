"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { stockFacet, type StockCollection } from "@/lib/stock-facets";
import type { StockRow } from "@/lib/stock-display";
import {
  listShowroomCollections,
  searchShowroomStock,
  type ShowroomStockFilter,
} from "../actions";
import { eyebrow, field } from "../showroom-ui";
import { FacetPicker } from "./FacetPicker";
import { InventoryCard } from "./InventoryCard";
import type { ViewMode } from "./ViewModeToggle";
import { ViewModeToggle } from "./ViewModeToggle";

const CATEGORIES: { id: ShowroomStockFilter; label: string }[] = [
  { id: "fabrics", label: "Fabrics" },
  { id: "dekton", label: "Dekton" },
  { id: "frames", label: "Frames" },
];

const VIEW_MODE_KEY = "ccpatio.showroom.viewMode";

type StockSort = "alpha" | "stock";

const floatControl =
  "relative overflow-hidden border border-slate-200 bg-white shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-3px_rgba(6,81,237,0.15)]";

function fuzzyIncludes(value: string, needle: string): boolean {
  const haystack = value.toLowerCase();
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function GoldBeam() {
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden="true">
      <span className="animate-beam-glide absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
    </span>
  );
}

function readViewMode(value: string | null): ViewMode | null {
  if (value === "grid" || value === "carousel" || value === "dropdown") return value;
  return null;
}

export function LiveStockView({
  defaultViewMode = "carousel",
  persistViewMode = true,
}: {
  defaultViewMode?: ViewMode;
  persistViewMode?: boolean;
} = {}) {
  const [category, setCategory] = useState<ShowroomStockFilter | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<StockSort>("alpha");
  const [collections, setCollections] = useState<StockCollection[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [viewModeHydrated, setViewModeHydrated] = useState(false);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);

  useEffect(() => {
    if (!persistViewMode) {
      setViewModeHydrated(true);
      return;
    }
    try {
      const stored = readViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
      if (stored) setViewMode(stored);
    } catch {
      // Private-mode storage can throw; the in-memory default remains.
    }
    setViewModeHydrated(true);
  }, [persistViewMode]);

  useEffect(() => {
    if (!persistViewMode || !viewModeHydrated) return;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Ignore quota and privacy errors; the session still keeps the choice.
    }
  }, [viewMode, viewModeHydrated, persistViewMode]);

  const activeCollection = collections.find(
    (item) => item.name.toLowerCase() === collection?.toLowerCase(),
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (variant && stockFacet(row.name).variant.toLowerCase() !== variant.toLowerCase()) {
        return false;
      }
      if (inStockOnly && row.available <= 0) return false;
      if (!needle) return true;
      return fuzzyIncludes(row.sku, needle) || fuzzyIncludes(row.name, needle);
    });
    return [...filtered].sort((left, right) => {
      if (sortBy === "stock") {
        return right.available - left.available || left.name.localeCompare(right.name);
      }
      return left.name.localeCompare(right.name) || left.sku.localeCompare(right.sku);
    });
  }, [rows, variant, query, inStockOnly, sortBy]);
  const showGrid = Boolean(collection);

  function chooseCategory(next: ShowroomStockFilter) {
    const id = ++request.current;
    setCategory(next);
    setCollection(null);
    setVariant(null);
    setQuery("");
    setRows([]);
    setMessage(null);
    startTransition(async () => {
      const result = await listShowroomCollections(next);
      if (id !== request.current) return;
      if (!result.ok) {
        setCollections([]);
        setMessage(result.error);
        return;
      }
      setCollections(result.collections);
      setMessage(result.collections.length === 0 ? "Nothing in this family." : null);
    });
  }

  function clearCollection() {
    request.current += 1;
    setCollection(null);
    setVariant(null);
    setRows([]);
    setMessage(null);
  }

  function chooseCollection(name: string) {
    if (!category) return;
    const id = ++request.current;
    setCollection(name);
    setVariant(null);
    setQuery("");
    setMessage(null);
    startTransition(async () => {
      const result = await searchShowroomStock({ filter: category, collection: name });
      if (id !== request.current) return;
      if (!result.ok) {
        setRows([]);
        setMessage(result.error);
        return;
      }
      setRows(result.rows);
      setMessage(result.rows.length === 0 ? "Nothing in this collection." : null);
    });
  }

  return (
    <section
      className="rounded-3xl bg-slate-50"
      data-stock-view={viewMode}
    >
      <div className="sticky top-0 z-30 space-y-4 border-b border-slate-200/70 bg-white/90 px-6 py-4 backdrop-blur-md sm:px-8">
        <div className="space-y-3">
          <p className={eyebrow}>Live stock</p>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or SKU"
              className={`${field} bg-white/80 pl-9 backdrop-blur-md`}
              aria-label="Search live stock"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={inStockOnly}
              onClick={() => setInStockOnly((current) => !current)}
              className={`${floatControl} inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-slate-700`}
            >
              <span
                className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${inStockOnly ? "bg-slate-900" : "bg-slate-200"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-300 ${inStockOnly ? "left-4" : "left-0.5"}`}
                />
              </span>
              In stock only
            </button>
            <label className="inline-flex items-center gap-2 text-xs text-slate-500">
              Sort by
              <select
                value={sortBy}
                aria-label="Sort by"
                onChange={(event) => setSortBy(event.target.value as StockSort)}
                className={`${floatControl} rounded-full px-3 py-2 text-xs text-slate-800`}
              >
                <option value="alpha">Alphabetical</option>
                <option value="stock">Highest stock first</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Category">
            {CATEGORIES.map((item) => {
              const selected = category === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`${floatControl} rounded-full px-4 py-2 text-sm ${
                    selected ? "border-[#C5A059]/70 text-slate-900" : "text-slate-600"
                  }`}
                  onClick={() => chooseCategory(item.id)}
                >
                  {selected ? <GoldBeam /> : null}
                  {item.label}
                </button>
              );
            })}
          </div>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      <div className="space-y-8 p-6 sm:p-8">

      <LayoutGroup id="showroom-live-stock">
        <AnimatePresence>
          {category ? (
            <motion.div
              key={category}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <p className={eyebrow}>Collection</p>
              <FacetPicker
                viewMode={viewMode}
                options={collections.map((item) => item.name)}
                value={collection}
                placeholder="Search Collections..."
                onSelect={chooseCollection}
                onClear={clearCollection}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {collection && activeCollection ? (
            <motion.div
              key={`${category}-${collection}`}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <p className={eyebrow}>Variant</p>
              <FacetPicker
                viewMode={viewMode}
                options={activeCollection.variants}
                value={variant}
                placeholder="Search Variants..."
                toggleActive
                onSelect={setVariant}
                onClear={() => setVariant(null)}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {pending ? <p className="text-sm text-slate-500">Reading Katana…</p> : null}
        {message ? <p className="text-sm text-slate-500">{message}</p> : null}
        {showGrid && !pending && rows.length > 0 && visible.length === 0 ? (
          <p className="text-sm text-slate-500">No variants match these filters.</p>
        ) : null}

        <AnimatePresence>
          {showGrid ? (
            <motion.div
              key={collection ?? "grid"}
              layout="position"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.22 }}
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
            >
              {visible.map((row) => (
                <InventoryCard key={row.sku} row={row} />
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </LayoutGroup>
      </div>
    </section>
  );
}
