"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  fetchPimDeltas,
  fetchPimRow,
  patchMappingField,
  seedSuggestedNaFields,
  type PimDeltaRow,
} from "./actions";
import { buildDictionaryColumns, EXEC_PILL, showExpandForRow } from "./columns";
import { calculateRowHealth, computeBatchCompletion } from "./pim-catalog-utils";
import { CategoryProgressBar } from "@/app/admin/shared/CategoryProgressBar";
import { handleInteractiveRowKeyDown } from "@/app/admin/shared/table-a11y";
import { getOperatorName, setOperatorName } from "./InlineCells";
import type { DictionaryTableMeta, SkuMappingRow } from "./types";
import { FinishedGoodDetailPanel } from "./FinishedGoodDetailPanel";
import { BomPanel } from "./BomPanel";
import { ProductDetailModal } from "./ProductDetailModal";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export type { SkuMappingRow, CatalogFields } from "./types";

type SkuTableProps = {
  rows: SkuMappingRow[];
  operatorEmail?: string | null;
};

const ALL_TAB = "All";

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(rows: SkuMappingRow[]): void {
  const header = [
    "global_sku",
    "item_type",
    "category",
    "original_name",
    "uom_purchase",
    "uom_consume",
    "base_cost",
    "msrp",
    "is_active",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.globalSku,
        row.itemType,
        row.category,
        row.originalName,
        row.uomPurchase ?? "",
        row.uomConsume ?? "",
        row.baseCost ?? "",
        row.catalog?.msrp ?? "",
        row.isActive ? "true" : "false",
      ]
        .map((cell) => escapeCsvCell(String(cell)))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ccpatio-sku-mappings-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SkuTable({ rows: initialRows, operatorEmail }: SkuTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quickFilter = searchParams.get("filter");
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [flashSkus, setFlashSkus] = useState<Record<string, boolean>>({});
  const [operator, setOperator] = useState("operator");
  const [syncLabel, setSyncLabel] = useState<"connecting" | "live" | "poll">(
    "connecting",
  );
  const [sinceIso, setSinceIso] = useState(() => new Date().toISOString());
  const [detailRow, setDetailRow] = useState<SkuMappingRow | null>(null);
  const [detailFocusMissing, setDetailFocusMissing] = useState(false);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (operatorEmail) {
      setOperator(operatorEmail);
      setOperatorName(operatorEmail);
      return;
    }
    setOperator(getOperatorName());
  }, [operatorEmail]);

  // One-time: persist inferred N/A (bar tables â†’ arm/sit) so Missing clears without manual clicks
  useEffect(() => {
    const fgSkus = initialRows
      .filter(
        (r) =>
          r.category.trim().toLowerCase() === "finished good" ||
          r.itemType === "finished_good",
      )
      .map((r) => r.globalSku);
    if (fgSkus.length === 0) return;
    void seedSuggestedNaFields(fgSkus).then((result) => {
      if (result.ok && result.updated > 0) {
        router.refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const applyLocalPatch = useCallback(
    (sku: string, patch: Partial<SkuMappingRow>) => {
      setRows((prev) =>
        prev.map((row) => (row.globalSku === sku ? { ...row, ...patch } : row)),
      );
      flashRow(sku);
    },
    [flashRow],
  );

  const applyRemoteDelta = useCallback(
    (delta: PimDeltaRow) => {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.globalSku === delta.globalSku);
        if (idx < 0) return prev;
        const cur = prev[idx]!;
        const next = [...prev];
        next[idx] = {
          ...cur,
          category: delta.category || cur.category,
          originalName: delta.originalName || cur.originalName,
          isActive: delta.isActive,
          itemType: delta.itemType ?? cur.itemType,
          uomPurchase: delta.uomPurchase ?? cur.uomPurchase,
          uomConsume: delta.uomConsume ?? cur.uomConsume,
          baseCost: delta.baseCost ?? cur.baseCost,
          attributes: delta.attributes ?? cur.attributes,
          version: delta.version ?? cur.version,
          katanaVariantId: delta.katanaVariantId,
          katanaMaterialId: delta.katanaMaterialId,
          wooAttributeSlug: delta.wooAttributeSlug,
          ghlDropdownValue: delta.ghlDropdownValue,
          mappingUpdatedAt: delta.mappingUpdatedAt,
          mappingUpdatedBy: delta.mappingUpdatedBy,
          catalog: delta.catalog ? { ...delta.catalog } : cur.catalog,
        };
        return next;
      });
      flashRow(delta.globalSku);
      const stamp =
        delta.catalog?.updatedAt ??
        delta.mappingUpdatedAt ??
        new Date().toISOString();
      setSinceIso((prev) => (stamp > prev ? stamp : prev));
    },
    [flashRow],
  );

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    const sinceRef = { current: sinceIso };

    if (supabase) {
      setSyncLabel("live");

      async function syncSkuFromDb(sku: string): Promise<void> {
        const delta = await fetchPimRow(sku);
        if (delta && !cancelled) {
          applyRemoteDelta(delta);
          const stamp =
            delta.catalog?.updatedAt ??
            delta.mappingUpdatedAt ??
            sinceRef.current;
          if (stamp > sinceRef.current) {
            sinceRef.current = stamp;
            setSinceIso(stamp);
          }
        }
      }

      const channel = supabase
        .channel("pim-dictionary")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sku_mappings" },
          (payload) => {
            const record = payload.new as Record<string, unknown> | null;
            if (!record?.global_sku) return;
            void syncSkuFromDb(String(record.global_sku));
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "finished_goods_catalog" },
          (payload) => {
            const record = payload.new as Record<string, unknown> | null;
            if (!record?.global_sku) return;
            void syncSkuFromDb(String(record.global_sku));
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
        const deltas = await fetchPimDeltas(sinceRef.current);
        if (cancelled || deltas.length === 0) return;
        for (const delta of deltas) {
          applyRemoteDelta(delta);
          const stamp =
            delta.catalog?.updatedAt ??
            delta.mappingUpdatedAt ??
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
  }, [applyRemoteDelta]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.category) set.add(row.category);
    }
    for (const extra of [
      "Finished Good",
      "Metal",
      "Powder",
      "Fabric",
      "Dekton",
      "Shade",
      "Furniture",
      "Firepit",
    ]) {
      set.add(extra);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const categoryTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.category || "Uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => ({ category, count }));
  }, [rows]);

  const columnTab = useMemo(() => {
    if (selectedCategories.size === 0) return ALL_TAB;
    if (selectedCategories.size === 1) {
      return [...selectedCategories][0] ?? ALL_TAB;
    }
    return ALL_TAB;
  }, [selectedCategories]);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const clearCategoryFilters = useCallback(() => {
    setSelectedCategories(new Set());
  }, []);

  const filtered = useMemo(() => {
    let byTab =
      selectedCategories.size === 0
        ? rows
        : rows.filter((row) =>
            selectedCategories.has(row.category || "Uncategorized"),
          );

    if (quickFilter === "catalog") {
      byTab = byTab.filter((row) => row.catalog !== null);
    } else if (quickFilter === "incomplete") {
      byTab = byTab.filter(
        (row) =>
          calculateRowHealth({
            category: row.category,
            itemType: row.itemType,
            originalName: row.originalName,
            globalSku: row.globalSku,
            attributes: row.attributes,
            catalog: row.catalog,
          }).hasMissingData,
      );
    } else if (quickFilter === "discontinued") {
      byTab = byTab.filter((row) => !row.isActive);
    }

    const needle = query.trim().toLowerCase();
    if (!needle) return byTab;
    return byTab.filter(
      (row) =>
        row.globalSku.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle) ||
        row.originalName.toLowerCase().includes(needle) ||
        row.itemType.toLowerCase().includes(needle),
    );
  }, [selectedCategories, query, rows, quickFilter]);

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
        originalName: row.originalName,
        globalSku: row.globalSku,
        attributes: row.attributes,
        catalog: row.catalog,
      })),
      label,
    );
  }, [filtered, selectedCategories]);

  useEffect(() => {
    setDetailRow((current) => {
      if (!current) return current;
      return rows.find((r) => r.globalSku === current.globalSku) ?? current;
    });
  }, [rows]);

  const openProductDetail = useCallback(
    (
      row: SkuMappingRow,
      options?: { focusMissing?: boolean },
      trigger?: HTMLElement | null,
    ) => {
      modalReturnFocusRef.current =
        trigger ?? (document.activeElement as HTMLElement | null);
      setDetailFocusMissing(options?.focusMissing ?? false);
      setDetailRow(row);
    },
    [],
  );

  const tableMeta: DictionaryTableMeta = useMemo(
    () => ({
      categoryOptions,
      columnTab,
      flashSkus,
      expanded,
      onPatchSaved: (sku, patch) => applyLocalPatch(sku, patch),
      onOpenProductDetail: openProductDetail,
      onToggleActive: (sku) => {
        const row = rows.find((r) => r.globalSku === sku);
        if (!row) return;
        const next = !row.isActive;
        applyLocalPatch(sku, {
          isActive: next,
          mappingUpdatedBy: getOperatorName(),
          mappingUpdatedAt: new Date().toISOString(),
          version: row.version + 1,
        });
        void patchMappingField({
          globalSku: sku,
          field: "is_active",
          value: next,
          updatedBy: getOperatorName(),
          expectedVersion: row.version,
        });
      },
      onToggleExpand: (sku) =>
        setExpanded((prev) => ({ ...prev, [sku]: !prev[sku] })),
      onNaChange: (sku, naFields) => {
        const existing = rows.find((r) => r.globalSku === sku)?.catalog;
        applyLocalPatch(sku, {
          catalog: {
            msrp: existing?.msrp ?? null,
            cost: existing?.cost ?? null,
            length: existing?.length ?? null,
            depth: existing?.depth ?? null,
            height: existing?.height ?? null,
            armHeight: existing?.armHeight ?? null,
            sitHeight: existing?.sitHeight ?? null,
            weight: existing?.weight ?? null,
            description: existing?.description ?? null,
            imageUrl: existing?.imageUrl ?? null,
            qboItemCode: existing?.qboItemCode ?? null,
            naFields,
            updatedAt: existing?.updatedAt,
            updatedBy: existing?.updatedBy,
          },
        });
      },
    }),
    [applyLocalPatch, columnTab, categoryOptions, expanded, flashSkus, openProductDetail, rows],
  );

  const columns = useMemo(
    () => buildDictionaryColumns(columnTab, tableMeta),
    [columnTab, tableMeta],
  );

  // TanStack Table returns non-memoizable helpers by design.
  // eslint-disable-next-line react-hooks/incompatible-library -- controlled inline editors
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.globalSku,
    meta: tableMeta,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sku = new URLSearchParams(window.location.search).get("sku");
    if (!sku) return;
    setQuery(sku);
    setExpanded((prev) => ({ ...prev, [sku]: true }));
  }, []);

  return (
    <section className="space-y-3 p-2 sm:p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Filter SKUs</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter SKU, name, category, item type..."
            className="pim-input py-2.5 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="uppercase tracking-wider">Signed in</span>
            <span className="font-mono text-emerald-300/90">{operator}</span>
          </label>
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
            shown
          </p>
          <button
            type="button"
            onClick={() => downloadCsv(filtered)}
            className="rounded-md border border-slate-700/60 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
          >
            Export CSV
          </button>
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
            count={rows.length}
            selected={selectedCategories.size === 0}
            onSelect={clearCategoryFilters}
            isAllTab
          />
          {categoryTabs.map((tab) => (
            <CategoryTab
              key={tab.category}
              label={tab.category}
              count={tab.count}
              selected={selectedCategories.has(tab.category)}
              onSelect={() => toggleCategory(tab.category)}
            />
          ))}
        </div>
      </div>

      <CategoryProgressBar stats={progressStats} />

      <div className="max-h-[min(75vh,62rem)] overflow-auto rounded-lg border border-slate-800/50">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="text-[10px] uppercase tracking-wider text-slate-500"
              >
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-2 py-3 font-medium">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-900/70">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-slate-500"
                >
                  No SKUs match this filter.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isOpen = Boolean(expanded[row.original.globalSku]);
                const canExpand = showExpandForRow(
                  row.original,
                  row.original.category,
                );
                const fgTab =
                  row.original.category.trim().toLowerCase() === "finished good" ||
                  row.original.category.trim().toLowerCase() === "furniture";
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-slate-900/35 ${
                        row.original.isActive ? "" : "opacity-55"
                      } ${flashSkus[row.original.globalSku] ? "pim-row-flash" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect ${row.original.globalSku}`}
                      onKeyDown={(event) =>
                        handleInteractiveRowKeyDown(event, () =>
                          openProductDetail(row.original, undefined, event.currentTarget),
                        )
                      }
                      onClick={(event) =>
                        openProductDetail(row.original, undefined, event.currentTarget)
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-2 py-2 align-top">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                    {canExpand && isOpen ? (
                      <tr>
                        <td
                          colSpan={columns.length}
                          className="bg-slate-950/40 px-4 py-5"
                        >
                          {fgTab ? (
                            <FinishedGoodDetailPanel
                              key={row.original.globalSku}
                              row={row.original}
                              meta={tableMeta}
                            />
                          ) : (
                            <BomPanel
                              key={row.original.globalSku}
                              productSku={row.original.globalSku}
                              itemType={row.original.itemType}
                            />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-600">
        Finished Good rows show image and dims inline. Use the expand control for
        description, QBO, Woo/GHL, audit stamp, and BOM.
      </p>

      <ProductDetailModal
        row={detailRow}
        open={detailRow !== null}
        focusMissing={detailFocusMissing}
        returnFocusRef={modalReturnFocusRef}
        onClose={() => {
          setDetailRow(null);
          setDetailFocusMissing(false);
        }}
        onPatchSaved={applyLocalPatch}
      />
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
