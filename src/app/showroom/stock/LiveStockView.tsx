"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { readActorFromHref } from "@/lib/embed-actor-params";
import { sellableCategoryTabs } from "@/lib/stock-categories";
import { stockFacet, type StockCollection } from "@/lib/stock-facets";
import type { StockRow } from "@/lib/stock-display";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  listActiveShowroomHolds,
  listShowroomCategoryItems,
  listShowroomCollections,
  loadOpsKatanaInventoryAction,
  resolveShowroomHoldActor,
  searchShowroomStock,
  type ActiveShowroomHold,
} from "../actions";
import { eyebrow, softField } from "../showroom-ui";
import { FacetPicker } from "./FacetPicker";
import { InventoryCard } from "./InventoryCard";
import type { ViewMode } from "./ViewModeToggle";
import { ViewModeToggle } from "./ViewModeToggle";

const VIEW_MODE_KEY = "ccpatio.showroom.viewMode";

type StockSort = "alpha" | "stock";
type TypeFilter = "all" | "finished" | "fabrics_powders" | "subassemblies_materials";

const softControl =
  "border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]";

const tactileIdle = "border-b-2 border-slate-200 bg-white text-slate-600";
const tactileActive = "translate-y-0.5 bg-slate-50 text-slate-900 shadow-inner";

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "finished", label: "Finished Goods" },
  { key: "fabrics_powders", label: "Fabrics & Powders" },
  { key: "subassemblies_materials", label: "Subassemblies & Materials" },
];

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

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function LiveStockView({
  defaultViewMode = "dropdown",
  persistViewMode = true,
  ghlUserId,
  ghlUserEmail,
  inventoryMode = "showroom",
  initialRows,
  initialSyncedAt,
}: {
  defaultViewMode?: ViewMode;
  persistViewMode?: boolean;
  ghlUserId?: string;
  ghlUserEmail?: string;
  /** `katana-ops` = full ground-truth inventory for GHL Current Inventory. */
  inventoryMode?: "showroom" | "katana-ops";
  initialRows?: StockRow[];
  initialSyncedAt?: string | null;
} = {}) {
  const { embedToken, embedFetch } = useEmbedSession();
  const isOps = inventoryMode === "katana-ops";
  const [categoryItems, setCategoryItems] = useState<{ category: string }[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<StockSort>("alpha");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [collections, setCollections] = useState<StockCollection[]>([]);
  const [rows, setRows] = useState<StockRow[]>(initialRows ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(initialSyncedAt ?? null);
  const [stale, setStale] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [viewModeHydrated, setViewModeHydrated] = useState(false);
  const [salesperson, setSalesperson] = useState<string | null>(null);
  const [holdActorError, setHoldActorError] = useState<string | null>(null);
  const [actorUserId, setActorUserId] = useState(ghlUserId);
  const [actorUserEmail, setActorUserEmail] = useState(ghlUserEmail);
  const [holds, setHolds] = useState<ActiveShowroomHold[]>([]);
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
      if (isOps && typeFilter !== "all") {
        const t = (row.itemType ?? "").toLowerCase();
        if (typeFilter === "finished" && !t.includes("finished") && !t.includes("product")) {
          return false;
        }
        if (typeFilter === "fabrics_powders") {
          const sku = row.sku.toUpperCase();
          if (
            !t.includes("fabric") &&
            !t.includes("powder") &&
            !t.includes("material") &&
            !sku.startsWith("FAB-") &&
            !sku.startsWith("PWD-") &&
            !sku.startsWith("MET-")
          ) {
            return false;
          }
        }
        if (typeFilter === "subassemblies_materials") {
          const sku = row.sku.toUpperCase();
          if (
            !t.includes("subassembl") &&
            !t.includes("material") &&
            !sku.startsWith("SA-") &&
            !sku.startsWith("ASM-") &&
            !sku.startsWith("FAB-") &&
            !sku.startsWith("PWD-") &&
            !sku.startsWith("MET-")
          ) {
            return false;
          }
        }
      }
      const facet = stockFacet(row.name);
      if (collection && facet.collection.toLowerCase() !== collection.toLowerCase()) {
        return false;
      }
      if (variant && facet.variant.toLowerCase() !== variant.toLowerCase()) {
        return false;
      }
      if (inStockOnly && row.available <= 0) return false;
      if (!needle) return true;
      return (
        fuzzyIncludes(row.sku, needle) ||
        fuzzyIncludes(row.name, needle) ||
        fuzzyIncludes(row.variantLabel ?? "", needle) ||
        fuzzyIncludes(row.locationName ?? "", needle) ||
        fuzzyIncludes(row.itemType ?? "", needle)
      );
    });
    return [...filtered].sort((left, right) => {
      if (sortBy === "stock") {
        return right.available - left.available || left.name.localeCompare(right.name);
      }
      return (
        left.name.localeCompare(right.name) ||
        (left.variantLabel ?? "").localeCompare(right.variantLabel ?? "") ||
        left.sku.localeCompare(right.sku)
      );
    });
  }, [rows, collection, variant, query, inStockOnly, sortBy, isOps, typeFilter]);
  const showGrid = isOps ? true : Boolean(category);

  const syncOpsInventory = useCallback(
    async (force = false) => {
      const id = ++request.current;
      setErrorBanner(null);
      try {
        let result = await loadOpsKatanaInventoryAction({
          force,
          embedToken,
          typeFilter: "all",
        });
        if (!result.ok && embedToken) {
          const res = await embedFetch(
            force
              ? "/api/katana/showroom-inventory"
              : "/api/katana/showroom-inventory",
            force ? { method: "POST" } : undefined,
          );
          const json = (await res.json()) as {
            ok: boolean;
            rows?: StockRow[];
            items?: StockRow[];
            syncedAt?: string;
            lastSyncedAt?: string | null;
            stale?: boolean;
            error?: string;
            warning?: string;
          };
          if (!res.ok || !json.ok) {
            result = { ok: false, error: json.error ?? "Could not read Hub inventory snapshot." };
          } else {
            result = {
              ok: true,
              rows: json.rows ?? json.items ?? [],
              syncedAt:
                json.lastSyncedAt ?? json.syncedAt ?? new Date().toISOString(),
              stale: Boolean(json.stale),
              warning: json.error ?? json.warning ?? null,
            };
          }
        }
        if (id !== request.current) return;
        if (!result.ok) {
          setErrorBanner(result.error);
          if (!rows.length) setMessage(result.error);
          return;
        }
        setRows(result.rows);
        setSyncedAt(result.syncedAt);
        setStale(result.stale);
        setMessage(
          result.rows.length === 0
            ? "Nothing in Katana inventory for this filter."
            : result.warning,
        );
        setErrorBanner(result.warning && result.stale ? result.warning : null);
      } catch (error: unknown) {
        if (id !== request.current) return;
        const msg = error instanceof Error ? error.message : "Could not read Katana.";
        setErrorBanner(msg);
        setMessage(msg);
      }
    },
    [embedToken, embedFetch, rows.length],
  );

  const chooseCategory = useCallback(
    (next: string) => {
      const id = ++request.current;
      setCategory(next);
      setCollection(null);
      setVariant(null);
      setQuery("");
      setRows([]);
      setCollections([]);
      setMessage(null);
      setErrorBanner(null);
      startTransition(async () => {
        try {
          const [listed, stock] = await Promise.all([
            listShowroomCollections(next, embedToken),
            searchShowroomStock({ filter: next, embedToken }),
          ]);
          if (id !== request.current) return;
          if (!listed.ok) {
            setCollections([]);
            setMessage(listed.error);
            setErrorBanner(listed.error);
          } else {
            setCollections(listed.collections);
          }
          if (!stock.ok) {
            setRows([]);
            setMessage(stock.error);
            setErrorBanner(stock.error);
            return;
          }
          setRows(stock.rows);
          if (stock.rows.length === 0) {
            setMessage("Nothing in this category.");
          } else if (listed.ok) {
            setMessage(null);
            setErrorBanner(null);
          }
        } catch (error: unknown) {
          if (id !== request.current) return;
          setCollections([]);
          setRows([]);
          const msg = error instanceof Error ? error.message : "Could not read Katana.";
          setMessage(msg);
          setErrorBanner(msg);
        }
      });
    },
    [embedToken],
  );

  useEffect(() => {
    let active = true;
    const fromUrl = readActorFromHref(window.location.href);
    const userId = ghlUserId?.trim() || fromUrl.ghlUserId;
    const email = ghlUserEmail?.trim() || fromUrl.ghlUserEmail;
    setActorUserId(userId);
    setActorUserEmail(email);
    setSalesperson(null);
    setHoldActorError(null);
    void resolveShowroomHoldActor({ ghlUserId: userId, ghlUserEmail: email }).then((result) => {
      if (!active) return;
      if (result.ok) setSalesperson(result.name);
      else setHoldActorError(result.error);
    });
    return () => {
      active = false;
    };
  }, [ghlUserId, ghlUserEmail]);

  const reloadRows = useCallback(async () => {
    if (isOps) {
      await syncOpsInventory(false);
      return;
    }
    if (!category) return;
    const id = ++request.current;
    try {
      const stock = await searchShowroomStock({ filter: category, embedToken });
      if (id !== request.current) return;
      if (!stock.ok) {
        setRows([]);
        setMessage(stock.error);
        setErrorBanner(stock.error);
        return;
      }
      setRows(stock.rows);
      setMessage(stock.rows.length === 0 ? "Nothing in this category." : null);
      setErrorBanner(null);
    } catch (error: unknown) {
      if (id !== request.current) return;
      setRows([]);
      const msg = error instanceof Error ? error.message : "Could not read Katana.";
      setMessage(msg);
      setErrorBanner(msg);
    }
  }, [category, embedToken, isOps, syncOpsInventory]);

  useEffect(() => {
    const ids = [...new Set(rows.map((row) => row.variantId))].filter((id) => id > 0);
    if (ids.length === 0) {
      setHolds([]);
      return;
    }
    let active = true;
    void listActiveShowroomHolds(ids).then((result) => {
      if (!active) return;
      setHolds(result.ok ? result.holds : []);
    });
    return () => {
      active = false;
    };
  }, [rows]);

  useEffect(() => {
    if (isOps) {
      if (initialRows && initialRows.length > 0) return;
      startTransition(() => {
        void syncOpsInventory(false);
      });
      return;
    }
    let active = true;
    startTransition(async () => {
      try {
        const listed = await listShowroomCategoryItems(embedToken);
        if (!active) return;
        if (!listed.ok) {
          setCategoryItems([]);
          setMessage(listed.error);
          setErrorBanner(listed.error);
          return;
        }
        setCategoryItems(listed.items);
        if (sellableCategoryTabs(listed.items).length === 0) {
          setMessage("No sellable categories in Katana.");
        }
      } catch (error: unknown) {
        if (!active) return;
        setCategoryItems([]);
        const msg =
          error instanceof Error ? error.message : "Could not read Katana categories.";
        setMessage(msg);
        setErrorBanner(msg);
      }
    });
    return () => {
      active = false;
    };
  }, [isOps, embedToken, initialRows, syncOpsInventory]);

  useEffect(() => {
    if (isOps) return;
    if (category !== null || categories.length === 0) return;
    chooseCategory(categories[0]);
  }, [category, categories, chooseCategory, isOps]);

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
      data-inventory-mode={inventoryMode}
    >
      <div className="sticky top-0 z-30 space-y-4 border-b border-slate-100 bg-[#F8F9FA]/90 px-6 py-4 backdrop-blur-md sm:px-8">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={eyebrow}>{isOps ? "Current Inventory · Katana" : "Live stock"}</p>
            {isOps ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    stale ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"
                  }`}
                  title={stale ? "Serving stale-while-revalidate cache" : "Fresh from Katana"}
                >
                  Last synced from Katana: {formatSyncedAt(syncedAt)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(() => {
                      void syncOpsInventory(true);
                    })
                  }
                  className={`${softControl} rounded-full px-3 py-2 text-xs font-semibold text-slate-800`}
                >
                  Sync Live from Katana
                </button>
              </div>
            ) : null}
          </div>
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
          {isOps ? (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Item type">
              {TYPE_FILTERS.map((pill) => {
                const selected = typeFilter === pill.key;
                return (
                  <button
                    key={pill.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`relative shrink-0 overflow-hidden rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      selected ? tactileActive : tactileIdle
                    }`}
                    onClick={() => setTypeFilter(pill.key)}
                  >
                    {selected ? <GoldBeam /> : null}
                    {pill.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {!isOps ? (
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
        ) : (
          <div className="flex justify-end">
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        )}
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        {errorBanner ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              className="rounded-full bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() =>
                startTransition(() => {
                  void (isOps ? syncOpsInventory(true) : reloadRows());
                })
              }
            >
              Retry Live Sync
            </button>
          </div>
        ) : null}

      <LayoutGroup id="showroom-live-stock">
        <AnimatePresence>
          {!isOps && category ? (
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
          {!isOps && collection && activeCollection ? (
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
        {holdActorError && !isOps ? (
          <p className="text-sm text-rose-700">Place Hold is unavailable. {holdActorError}</p>
        ) : null}
        {message && !errorBanner ? <p className="text-sm text-slate-500">{message}</p> : null}
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
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {visible.map((row) => (
                <InventoryCard
                  key={`${row.sku}-${row.locationName ?? "all"}`}
                  row={row}
                  opsMode={isOps}
                  salesperson={salesperson}
                  canHold={Boolean(salesperson) && !holdActorError && !isOps}
                  holdDisabledReason={isOps ? "Holds use the showroom floor view." : holdActorError}
                  ghlUserId={actorUserId}
                  ghlUserEmail={actorUserEmail}
                  holds={holds.filter((hold) => hold.variantId === row.variantId)}
                  onHoldPlaced={() => {
                    void reloadRows();
                  }}
                  onOptimisticRelease={(holdId) => {
                    setHolds((current) => current.filter((hold) => hold.id !== holdId));
                  }}
                  onReleaseFailed={() => {
                    const ids = [...new Set(rows.map((item) => item.variantId))].filter(
                      (id) => id > 0,
                    );
                    void listActiveShowroomHolds(ids).then((result) => {
                      if (result.ok) setHolds(result.holds);
                    });
                  }}
                  onHoldReleased={() => {
                    void reloadRows();
                  }}
                  onHoldExtended={(holdId, expiresAt) => {
                    setHolds((current) =>
                      current.map((hold) =>
                        hold.id === holdId ? { ...hold, expiresAt } : hold,
                      ),
                    );
                  }}
                />
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </LayoutGroup>
      </div>
    </section>
  );
}
