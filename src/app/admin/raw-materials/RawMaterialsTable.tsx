"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  deleteRawMaterial,
  fetchRawMaterialBySku,
  fetchRawMaterialDeltas,
  type RawMaterialRow,
} from "./actions";
import { computeBatchCompletion } from "@/app/admin/dictionary/pim-catalog-utils";
import { CategoryProgressBar } from "@/app/admin/shared/CategoryProgressBar";
import { handleInteractiveRowKeyDown } from "@/app/admin/shared/table-a11y";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { CreateRawMaterialModal } from "./CreateRawMaterialModal";
import {
  RawMaterialDetailModal,
  RawMaterialHealthBadge,
} from "./RawMaterialDetailModal";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const EXEC_PILL =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums";

const ALL_TAB = "All";

const CATEGORY_PRESETS = [
  "Fabric",
  "Metal",
  "Powder",
  "Powder Coat",
  "Aluminum",
  "Dekton",
  "Shade",
  "Hardware",
  "Sub-Assembly",
  "Other",
] as const;

const CATEGORY_OPTIONS = [
  "Fabric",
  "Aluminum",
  "Powder Coat",
  "Dekton",
  "Shade",
  "Metal",
  "Hardware",
  "Sub-Assembly",
  "Other",
] as const;

type Props = {
  rows: RawMaterialRow[];
  onFilteredStatsChange?: (stats: FilteredStats) => void;
};

export type FilteredStats = {
  materials: number;
  categories: number;
  withCost: number;
};

function mergeRemoteRow(
  prev: RawMaterialRow[],
  incoming: RawMaterialRow,
  deletedSku?: string,
): RawMaterialRow[] {
  if (deletedSku) {
    return prev.filter((row) => row.sku !== deletedSku);
  }
  const idx = prev.findIndex((row) => row.sku === incoming.sku);
  if (idx < 0) {
    return [...prev, incoming].sort((a, b) => {
      const cat = a.category.localeCompare(b.category);
      if (cat !== 0) return cat;
      return a.sku.localeCompare(b.sku);
    });
  }
  const next = [...prev];
  next[idx] = { ...next[idx]!, ...incoming };
  return next;
}

export function RawMaterialsTable({ rows: initialRows, onFilteredStatsChange }: Props) {
  const toast = useToast();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [localRows, setLocalRows] = useState(initialRows);
  const [flashSkus, setFlashSkus] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [syncLabel, setSyncLabel] = useState<"connecting" | "live" | "poll">(
    "connecting",
  );
  const [sinceIso, setSinceIso] = useState(() => new Date().toISOString());
  const [detailRow, setDetailRow] = useState<RawMaterialRow | null>(null);
  const [detailFocusMissing, setDetailFocusMissing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLocalRows(initialRows);
  }, [initialRows]);

  const flashRow = useCallback((sku: string) => {
    setFlashSkus((prev) => ({ ...prev, [sku]: true }));
    window.setTimeout(() => {
      setFlashSkus((prev) => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
    }, 700);
  }, []);

  const applyRemoteRow = useCallback(
    (material: RawMaterialRow | null, deletedSku?: string) => {
      if (deletedSku) {
        setLocalRows((prev) => mergeRemoteRow(prev, material!, deletedSku));
        return;
      }
      if (!material) return;
      setLocalRows((prev) => mergeRemoteRow(prev, material));
      flashRow(material.sku);
      const stamp =
        material.catalogUpdatedAt ??
        material.mappingUpdatedAt ??
        new Date().toISOString();
      setSinceIso((prev) => (stamp > prev ? stamp : prev));
    },
    [flashRow, setLocalRows, setSinceIso],
  );

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    const sinceRef = { current: sinceIso };

    if (supabase) {
      setSyncLabel("live");

      async function syncSkuFromDb(sku: string): Promise<void> {
        const material = await fetchRawMaterialBySku(sku);
        if (cancelled) return;
        if (material) {
          applyRemoteRow(material);
        } else {
          applyRemoteRow(null, sku.trim().toUpperCase());
        }
      }

      const channel = supabase
        .channel("pim-raw-materials")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sku_mappings" },
          (payload) => {
            const record =
              (payload.new as Record<string, unknown> | null) ??
              (payload.old as Record<string, unknown> | null);
            const sku = record?.global_sku;
            if (!sku) return;
            void syncSkuFromDb(String(sku));
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "raw_materials_catalog" },
          (payload) => {
            const record =
              (payload.new as Record<string, unknown> | null) ??
              (payload.old as Record<string, unknown> | null);
            const sku = record?.sku;
            if (!sku) return;
            if (payload.eventType === "DELETE") {
              void syncSkuFromDb(String(sku));
              return;
            }
            void syncSkuFromDb(String(sku));
          },
        )
        .subscribe();

      return () => {
        cancelled = true;
        void supabase.removeChannel(channel);
      };
    }

    setSyncLabel("poll");
    const timer = window.setInterval(() => {
      void (async () => {
        const deltas = await fetchRawMaterialDeltas(sinceRef.current);
        if (cancelled || deltas.length === 0) return;
        for (const material of deltas) {
          applyRemoteRow(material);
          const stamp =
            material.catalogUpdatedAt ??
            material.mappingUpdatedAt ??
            sinceRef.current;
          if (stamp > sinceRef.current) {
            sinceRef.current = stamp;
            setSinceIso(stamp);
          }
        }
      })();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRemoteRow]);

  const categoryTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of localRows) {
      const key = row.category || "Uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const preset of CATEGORY_PRESETS) {
      if (!counts.has(preset)) {
        counts.set(preset, 0);
      }
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [localRows]);

  const filtered = useMemo(() => {
    const byCategory =
      selectedCategories.size === 0
        ? localRows
        : localRows.filter((row) =>
            selectedCategories.has(row.category || "Uncategorized"),
          );

    const needle = query.trim().toLowerCase();
    if (!needle) return byCategory;
    return byCategory.filter(
      (row) =>
        row.sku.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle),
    );
  }, [localRows, query, selectedCategories]);

  const progressStats = useMemo(() => {
    const label =
      selectedCategories.size === 1
        ? ([...selectedCategories][0] ?? ALL_TAB)
        : selectedCategories.size > 1
          ? `${selectedCategories.size} categories`
          : ALL_TAB;
    return computeBatchCompletion(
      filtered.map((row) => ({
        category: row.category,
        itemType: row.itemType,
        originalName: row.name,
        globalSku: row.sku,
        attributes: row.attributes,
        catalog: null,
      })),
      label,
    );
  }, [filtered, selectedCategories]);

  const filteredStats = useMemo((): FilteredStats => {
    const categories = new Set(
      filtered.map((row) => row.category || "Uncategorized"),
    );
    return {
      materials: filtered.length,
      categories: categories.size,
      withCost: filtered.filter((row) => row.costPerUnit).length,
    };
  }, [filtered]);

  useEffect(() => {
    onFilteredStatsChange?.(filteredStats);
  }, [filteredStats, onFilteredStatsChange]);

  const defaultCreateCategory = useMemo(() => {
    if (selectedCategories.size !== 1) return "";
    const [cat] = [...selectedCategories];
    if (!cat) return "";
    return (
      CATEGORY_OPTIONS.find((opt) => opt.toLowerCase() === cat.toLowerCase()) ??
      (cat === "Powder" ? "Powder Coat" : cat)
    );
  }, [selectedCategories]);

  function toggleCategory(category: string): void {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function openDetail(
    row: RawMaterialRow,
    focusMissing = false,
    trigger?: HTMLElement | null,
  ): void {
    modalReturnFocusRef.current =
      trigger ?? (document.activeElement as HTMLElement | null);
    setDetailFocusMissing(focusMissing);
    setDetailRow(row);
  }

  function onDelete(sku: string): void {
    if (!window.confirm(`Delete raw material ${sku}?`)) {
      return;
    }
    setError(null);
    const snapshot = localRows;
    setLocalRows((prev) => prev.filter((row) => row.sku !== sku));

    startTransition(async () => {
      const result = await deleteRawMaterial(sku);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        setLocalRows(snapshot);
        return;
      }
      toast.success(`Deleted ${sku}`);
    });
  }

  return (
    <section className="space-y-3 p-2 sm:p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Filter raw materials</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by SKU, name, or category…"
            className="pim-input py-2.5 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25"
          >
            Add Raw Material
          </button>
          <span
            className={`${EXEC_PILL} ${
              syncLabel === "live"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : syncLabel === "poll"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : "border-slate-600/50 bg-slate-800/60 text-slate-400"
            }`}
          >
            {syncLabel === "live"
              ? "Realtime live"
              : syncLabel === "poll"
                ? "Poll sync"
                : "Connecting..."}
          </span>
          <p className="text-xs tabular-nums text-slate-500">
            <span className="font-medium text-slate-300">{filtered.length}</span>{" "}
            shown · {localRows.length} total
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Categories{" "}
          <span className="font-normal normal-case tracking-normal text-slate-600">
            (Click to toggle multiple)
          </span>
        </p>
        <div
          role="tablist"
          className="flex gap-1 overflow-x-auto border-b border-slate-800/80 pb-px scrollbar-none"
        >
          <CategoryTab
            label={ALL_TAB}
            count={localRows.length}
            selected={selectedCategories.size === 0}
            onSelect={() => setSelectedCategories(new Set())}
            isAllTab
          />
          {categoryTabs.map(([category, count]) => (
            <CategoryTab
              key={category}
              label={category}
              count={count}
              selected={selectedCategories.has(category)}
              onSelect={() => toggleCategory(category)}
            />
          ))}
        </div>
      </div>

      <CategoryProgressBar stats={progressStats} />

      <div className="overflow-hidden rounded-lg border border-slate-800/50">
        <div className="max-h-[min(75vh,62rem)] overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-3 font-medium">SKU (Auto)</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 font-medium">UOM</th>
                <th className="px-3 py-3 font-medium">Cost / Unit</th>
                <th className="px-3 py-3 font-medium">Data Health</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/70">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No raw materials match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.sku}
                    className={`cursor-pointer transition-colors hover:bg-slate-900/35 ${
                      flashSkus[row.sku] ? "pim-row-flash" : ""
                    } ${!row.isActive ? "opacity-55" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${row.sku}`}
                    onKeyDown={(event) =>
                      handleInteractiveRowKeyDown(event, () =>
                        openDetail(row, false, event.currentTarget),
                      )
                    }
                    onClick={(event) => openDetail(row, false, event.currentTarget)}
                  >
                    <td className="px-3 py-2.5 font-mono text-[13px] text-slate-100">
                      {row.sku}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block truncate text-slate-300">
                        {row.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{row.category}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">
                      {row.unitOfMeasure}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">
                      {row.costPerUnit ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                        <RawMaterialHealthBadge
                          row={row}
                          onResolve={(trigger) => openDetail(row, true, trigger)}
                        />
                    </td>
                    <td className="px-3 py-2.5">
                      <div
                        className="flex flex-wrap items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openDetail(row, false, event.currentTarget);
                          }}
                          aria-label={`Inspect ${row.sku}`}
                          title="Inspect / edit"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/60 text-slate-400 transition hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300"
                        >
                          <InspectIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(row.sku)}
                          disabled={isPending}
                          aria-label={`Delete ${row.sku}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateRawMaterialModal
        open={createOpen}
        defaultCategory={defaultCreateCategory}
        returnFocusRef={addButtonRef}
        onClose={() => setCreateOpen(false)}
        onCreated={(material) => {
          setLocalRows((prev) => mergeRemoteRow(prev, material));
          flashRow(material.sku);
        }}
      />

      <RawMaterialDetailModal
        row={detailRow}
        open={detailRow !== null}
        focusMissing={detailFocusMissing}
        returnFocusRef={modalReturnFocusRef}
        onClose={() => {
          setDetailRow(null);
          setDetailFocusMissing(false);
        }}
        onSaved={(material) => {
          setLocalRows((prev) => mergeRemoteRow(prev, material));
          flashRow(material.sku);
        }}
      />

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      <p className="text-[11px] text-slate-600">
        Edits sync to{" "}
        <code className="font-mono text-slate-500">sku_mappings</code> and the
        Global SKU Dictionary in real time. Deletions are blocked when a SKU is
        referenced in a BOM.
      </p>
    </section>
  );
}

function CategoryTab({
  label,
  count,
  selected,
  onSelect,
  isAllTab = false,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  isAllTab?: boolean;
}) {
  const showRemoveIndicator = selected && !isAllTab;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
        selected
          ? "border-emerald-500 text-emerald-300"
          : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {showRemoveIndicator ? (
        <span
          className={`${EXEC_PILL} inline-flex items-center gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-300`}
        >
          <span>{label}</span>
          <span className="text-xs leading-none opacity-80" aria-hidden>
            ×
          </span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <span
        className={`${EXEC_PILL} ${
          selected
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            : "border-slate-700/50 bg-slate-900/80 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function InspectIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 9.24A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-9.24.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.06 1.06L8.94 10 7.53 11.41a.75.75 0 101.06 1.06L10 11.06l1.41 1.41a.75.75 0 101.06-1.06L11.06 10l1.41-1.41a.75.75 0 00-1.06-1.06L10 8.94 8.58 7.72z"
        clipRule="evenodd"
      />
    </svg>
  );
}
