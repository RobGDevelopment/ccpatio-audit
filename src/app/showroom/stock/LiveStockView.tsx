"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { sellableCategoryTabs } from "@/lib/stock-categories";
import { stockFacet, type StockCollection } from "@/lib/stock-facets";
import type { StockRow } from "@/lib/stock-display";
import {
  listShowroomCategoryItems,
  listShowroomCollections,
  searchShowroomStock,
} from "../actions";
import { eyebrow, softField } from "../showroom-ui";
import { FacetPicker } from "./FacetPicker";
import { InventoryCard } from "./InventoryCard";
import type { ViewMode } from "./ViewModeToggle";
import { ViewModeToggle } from "./ViewModeToggle";

const VIEW_MODE_KEY = "ccpatio.showroom.viewMode";

type StockSort = "alpha" | "stock";

const softControl =
  "border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]";

const tactileIdle = "border-b-2 border-slate-200 bg-white text-slate-600";
const tactileActive = "translate-y-0.5 bg-slate-50 text-slate-900 shadow-inner";

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
      <span className="animate-beam-glide-lux absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
    </span>
  );
}

function readViewMode(value: string | null): ViewMode | null {
  if (value === "grid" || value === "carousel" || value === "dropdown") return value;
  return null;
}

export function LiveStockView({
  defaultViewMode = "dropdown",
  persistViewMode = true,
}: {
  defaultViewMode?: ViewMode;
  persistViewMode?: boolean;
} = {}) {
  const [categoryItems, setCategoryItems] = useState<{ category: string }[]>([]);
  const [category, setCategory] = useState<string | null>(null);
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
  const categories = useMemo(() => sellableCategoryTabs(categoryItems), [categoryItems]);

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
      const facet = stockFacet(row.name);
      if (collection && facet.collection.toLowerCase() !== collection.toLowerCase()) {
        return false;
      }
      if (variant && facet.variant.toLowerCase() !== variant.toLowerCase()) {
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
  }, [rows, collection, variant, query, inStockOnly, sortBy]);
  const showGrid = Boolean(category);

  const chooseCategory = useCallback((next: string) => {
    const id = ++request.current;
    setCategory(next);
    setCollection(null);
    setVariant(null);
    setQuery("");
    setRows([]);
    setCollections([]);
    setMessage(null);
    startTransition(async () => {
      try {
        const [listed, stock] = await Promise.all([
          listShowroomCollections(next),
          searchShowroomStock({ filter: next }),
        ]);
        if (id !== request.current) return;
        if (!listed.ok) {
          setCollections([]);
          setMessage(listed.error);
        } else {
          setCollections(listed.collections);
        }
        if (!stock.ok) {
          setRows([]);
          setMessage(stock.error);
          return;
        }
        setRows(stock.rows);
        if (stock.rows.length === 0) {
          setMessage("Nothing in this category.");
        } else if (listed.ok) {
          setMessage(null);
        }
      } catch (error: unknown) {
        if (id !== request.current) return;
        setCollections([]);
        setRows([]);
        setMessage(error instanceof Error ? error.message : "Could not read Katana.");
      }
    });
  }, []);

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      try {
        const listed = await listShowroomCategoryItems();
        if (!active) return;
        if (!listed.ok) {
          setCategoryItems([]);
          setMessage(listed.error);
          return;
        }
        setCategoryItems(listed.items);
        if (sellableCategoryTabs(listed.items).length === 0) {
          setMessage("No sellable categories in Katana.");
        }
      } catch (error: unknown) {
        if (!active) return;
        setCategoryItems([]);
        setMessage(error instanceof Error ? error.message : "Could not read Katana categories.");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (category !== null || categories.length === 0) return;
    chooseCategory(categories[0]);
  }, [category, categories, chooseCategory]);

  function clearCollection() {
    setCollection(null);
    setVariant(null);
  }

  function chooseCollection(name: string) {
    setCollection(name);
    setVariant(null);
  }

  return (
    <section
      className="rounded-3xl bg-[#F8F9FA]"
      data-stock-view={viewMode}
    >
      <div className="sticky top-0 z-30 space-y-4 border-b border-slate-100 bg-[#F8F9FA]/90 px-6 py-4 backdrop-blur-md sm:px-8">
        <div className="space-y-3">
          <p className={eyebrow}>Live stock</p>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or SKU"
              className={`${softField} pl-9`}
              aria-label="Search live stock"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={inStockOnly}
              onClick={() => setInStockOnly((current) => !current)}
              className={`${softControl} inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-slate-700`}
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
                className={`${softControl} rounded-full px-3 py-2 text-xs text-slate-800`}
              >
                <option value="alpha">Alphabetical</option>
                <option value="stock">Highest stock first</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="tablist" aria-label="Category">
            {categories.map((name) => {
              const selected = category === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`relative shrink-0 overflow-hidden rounded-lg px-4 py-2 text-sm transition-all duration-150 ease-out ${
                    selected ? tactileActive : tactileIdle
                  }`}
                  onClick={() => chooseCategory(name)}
                >
                  {selected ? <GoldBeam /> : null}
                  {name}
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
              key={category ?? "grid"}
              layout="position"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.22 }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
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
