"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useRef, useState, useTransition } from "react";
import { stockFacet, type StockCollection } from "@/lib/stock-facets";
import type { StockRow } from "@/lib/stock-display";
import {
  listShowroomCollections,
  searchShowroomStock,
  type ShowroomStockFilter,
} from "../actions";
import { eyebrow, field, pillActive, pillBase, pillIdle } from "../showroom-ui";
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

  const searching = query.trim().length >= 2;
  const activeCollection = collections.find(
    (item) => item.name.toLowerCase() === collection?.toLowerCase(),
  );
  const visible = searching
    ? rows
    : rows.filter((row) => {
        if (!variant) return true;
        return stockFacet(row.name).variant.toLowerCase() === variant.toLowerCase();
      });
  const showGrid = searching || Boolean(collection);

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

  function onQuery(next: string) {
    setQuery(next);
    if (next.trim().length < 2) {
      request.current += 1;
      if (!collection) setRows([]);
      setMessage(null);
      return;
    }
    const id = ++request.current;
    setCollection(null);
    setVariant(null);
    startTransition(async () => {
      const result = await searchShowroomStock({ query: next });
      if (id !== request.current) return;
      if (!result.ok) {
        setRows([]);
        setMessage(result.error);
        return;
      }
      setRows(result.rows);
      setMessage(result.rows.length === 0 ? "Nothing matches." : null);
    });
  }

  return (
    <section
      className="space-y-8 rounded-3xl bg-slate-50 p-6 sm:p-8"
      data-stock-view={viewMode}
    >
      <div className="space-y-3">
        <p className={eyebrow}>Live stock</p>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search by name or SKU"
          className={`${field} bg-white`}
          aria-label="Search live stock"
        />
      </div>

      <div className="space-y-3">
        <p className={eyebrow}>Category</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${pillBase} ${category === item.id && !searching ? pillActive : pillIdle}`}
                onClick={() => chooseCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      <LayoutGroup id="showroom-live-stock">
        <AnimatePresence>
          {category && !searching ? (
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
          {collection && activeCollection && !searching ? (
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

        <AnimatePresence>
          {showGrid ? (
            <motion.div
              key={searching ? "search" : collection ?? "grid"}
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
    </section>
  );
}
