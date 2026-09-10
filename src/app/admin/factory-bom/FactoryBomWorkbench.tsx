"use client";

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import {
  approveDraftRecipe,
  deleteDraftBomLine,
  deleteDraftOperation,
  getDraftBomTree,
  getRecipeEstimate,
  listDraftLinesForParent,
  listDraftOperations,
  publishApprovedRecipeToKatana,
  recalculateEstimatesAction,
  searchFactoryMaterials,
  updateEstimateOverridesAction,
  upsertDraftBomLine,
  upsertDraftOperation,
  type BomComponentCandidate,
  type BomTreeNode,
  type DraftBomLine,
  type DraftOperationRow,
  type FactoryProductRow,
  type RecipeEstimateRow,
} from "./actions";
import type { RecipeReviewStatus } from "@/server/db/schema";
import { BomAssemblyCard } from "./BomAssemblyCard";
import { CadUploadDropzone } from "./CadUploadDropzone";
import { FactoryProductSidebar } from "./FactoryProductSidebar";
import { RecipeHeader } from "./RecipeHeader";
import { PIM_INPUT } from "./factory-bom-ui";

function flattenTree(node: BomTreeNode): BomTreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function MaterialCombobox({
  value,
  onChange,
  disabled,
  testId = "factory-bom-material-combobox",
}: {
  value: string;
  onChange: (sku: string, hit?: BomComponentCandidate) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<BomComponentCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchFactoryMaterials(query);
        if (!cancelled) {
          setOptions(rows);
          setHighlightIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const visible = useMemo(() => {
    const sorted = [...options].sort((a, b) => {
      const catA = a.category || "Uncategorized";
      const catB = b.category || "Uncategorized";
      if (catA !== catB) return catA.localeCompare(catB);
      return a.sku.localeCompare(b.sku);
    });
    return sorted.slice(0, 15);
  }, [options]);

  function select(hit: BomComponentCandidate): void {
    onChange(hit.sku, hit);
    setQuery(hit.sku);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && visible[highlightIndex]) {
      event.preventDefault();
      select(visible[highlightIndex]!);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <input
        role="combobox"
        data-testid={testId}
        aria-expanded={open}
        aria-controls={listboxId}
        value={query}
        disabled={disabled}
        placeholder="Search fabric, metal, foam, powder…"
        className={PIM_INPUT}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-800/95"
        >
          {loading ? (
            <li className="px-3 py-2 text-xs text-zinc-500">Searching…</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>
          ) : (
            visible.map((hit, idx) => {
              const prev = idx > 0 ? visible[idx - 1] : null;
              const cat = hit.category || "Uncategorized";
              const showHeader = !prev || (prev.category || "Uncategorized") !== cat;
              return (
                <Fragment key={hit.sku}>
                  {showHeader ? (
                    <li className="bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                      {cat}
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={idx === highlightIndex}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-xs ${
                        idx === highlightIndex ? "bg-zinc-700/80" : "hover:bg-zinc-700/80"
                      }`}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onClick={() => select(hit)}
                      data-testid={`factory-bom-material-option-${hit.sku}`}
                    >
                      <span className="font-semibold text-zinc-100">{hit.name}</span>
                      <span className="font-mono text-zinc-500">{hit.sku}</span>
                    </button>
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

type AssemblyBundle = {
  node: BomTreeNode;
  lines: DraftBomLine[];
  ops: DraftOperationRow[];
};

export function FactoryBomWorkbench({
  products,
  initialSku,
}: {
  products: FactoryProductRow[];
  initialSku?: string;
}) {
  const toast = useToast();
  const resolvedInitial =
    initialSku && products.some((row) => row.sku === initialSku)
      ? initialSku
      : (products[0]?.sku ?? "");
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"all" | "1" | "2">("all");
  const [selectedSku, setSelectedSku] = useState(resolvedInitial);
  const [tree, setTree] = useState<BomTreeNode | null>(null);
  const [bundles, setBundles] = useState<AssemblyBundle[]>([]);
  const [activeParent, setActiveParent] = useState(resolvedInitial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [bannerStatus, setBannerStatus] = useState<RecipeReviewStatus | "none">(
    products.find((row) => row.sku === resolvedInitial)?.reviewStatus ?? "none",
  );
  const [liveCopied, setLiveCopied] = useState(false);
  const [estimate, setEstimate] = useState<RecipeEstimateRow | null>(null);

  const selected = products.find((row) => row.sku === selectedSku) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((row) => {
      if (phase === "1" && !row.phaseSource.includes("phase1")) return false;
      if (phase === "2" && !row.phaseSource.includes("phase2")) return false;
      if (!q) return true;
      return (
        row.sku.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.collection.toLowerCase().includes(q)
      );
    });
  }, [products, query, phase]);

  async function loadBundles(rootSku: string): Promise<{
    nextTree: BomTreeNode | null;
    nextBundles: AssemblyBundle[];
  }> {
    const nextTree = await getDraftBomTree(rootSku);
    if (!nextTree) return { nextTree: null, nextBundles: [] };
    const parents = flattenTree(nextTree).filter(
      (n) => n.depth === 0 || n.itemType === "sub_assembly",
    );
    const nextBundles: AssemblyBundle[] = [];
    for (const node of parents) {
      const [lines, ops] = await Promise.all([
        listDraftLinesForParent(node.sku),
        listDraftOperations(node.sku),
      ]);
      nextBundles.push({ node, lines, ops });
    }
    return { nextTree, nextBundles };
  }

  async function reload(sku: string): Promise<void> {
    const [{ nextTree, nextBundles }, nextEstimate] = await Promise.all([
      loadBundles(sku),
      getRecipeEstimate(sku),
    ]);
    setTree(nextTree);
    setBundles(nextBundles);
    setEstimate(nextEstimate);
    if (
      nextBundles.length > 0 &&
      !nextBundles.some((bundle) => bundle.node.sku === activeParent)
    ) {
      setActiveParent(sku);
    }
  }

  useEffect(() => {
    const row = products.find((item) => item.sku === selectedSku);
    if (!row) return;
    setBannerStatus(row.reviewStatus);
    setLiveCopied(Boolean(row.liveBom));
  }, [products, selectedSku]);

  useEffect(() => {
    if (!selectedSku) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const [{ nextTree, nextBundles }, nextEstimate] = await Promise.all([
          loadBundles(selectedSku),
          getRecipeEstimate(selectedSku),
        ]);
        if (cancelled) return;
        setTree(nextTree);
        setBundles(nextBundles);
        setEstimate(nextEstimate);
        setActiveParent(selectedSku);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load draft BOM",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSku]);

  function onSaveLine(
    line: DraftBomLine,
    next: {
      quantity: string;
      scrapFactor: string;
      unitOfMeasure: string;
      notes: string;
    },
  ): void {
    setError(null);
    startTransition(async () => {
      const result = await upsertDraftBomLine({
        id: line.id,
        parentSku: line.parentSku,
        childSku: line.childSku,
        quantity: next.quantity,
        scrapFactor: next.scrapFactor,
        unitOfMeasure: next.unitOfMeasure,
        notes: next.notes,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Draft quantity updated");
      setBannerStatus("edited");
      await reload(selectedSku);
    });
  }

  function onRemoveLine(id: string): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteDraftBomLine(id);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      await reload(selectedSku);
    });
  }

  function onAddLine(data: {
    parentSku: string;
    childSku: string;
    quantity: string;
    scrapFactor: string;
    unitOfMeasure: string;
  }): void {
    setError(null);
    setActiveParent(data.parentSku);
    startTransition(async () => {
      const result = await upsertDraftBomLine(data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Draft line saved");
      setBannerStatus("edited");
      await reload(selectedSku);
    });
  }

  function onAddOp(data: {
    itemSku: string;
    workCenter: string;
    sequence: number;
    setupTimeMins: string;
    runTimeMins: string;
  }): void {
    setError(null);
    startTransition(async () => {
      const result = await upsertDraftOperation({
        itemSku: data.itemSku,
        workCenter: data.workCenter,
        sequence: data.sequence,
        setupTimeMins: data.setupTimeMins,
        runTimeMins: data.runTimeMins,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Draft routing saved");
      setBannerStatus("edited");
      await reload(selectedSku);
    });
  }

  function onRemoveOp(id: string): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteDraftOperation(id);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      await reload(selectedSku);
    });
  }

  function onApprove(): void {
    if (!selectedSku) return;
    const includePack = Boolean(estimate?.overrides.includePackagingBom);
    const applyWeight = Boolean(estimate?.overrides.applyEstimatedWeight);
    if (
      !window.confirm(
        `Copy the draft recipe for ${selectedSku} into live product_bom?${
          includePack ? " Packaging BOM will be included." : ""
        }${applyWeight ? " FG weight will be updated." : ""} Katana is not updated until catalog publish.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await approveDraftRecipe(selectedSku, {
        includePackagingBom: includePack,
        applyEstimatedWeight: applyWeight,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Draft copied to live product_bom");
      setBannerStatus("factory_approved");
      setLiveCopied(true);
      await reload(selectedSku);
    });
  }

  function onRecalculateEstimates(forceOps: boolean): void {
    if (!selectedSku) return;
    startTransition(async () => {
      const result = await recalculateEstimatesAction(selectedSku, { forceOps });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setEstimate(result.estimate);
      toast.success("Estimates recalculated");
      await reload(selectedSku);
    });
  }

  function onSaveEstimateOverrides(patch: {
    weightLbs?: number;
    dimWeightLbs?: number;
    laborMinutes?: number;
    includePackagingBom?: boolean;
    applyEstimatedWeight?: boolean;
  }): void {
    if (!selectedSku) return;
    startTransition(async () => {
      const result = await updateEstimateOverridesAction(selectedSku, patch);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setEstimate(result.estimate);
    });
  }

  const rootBundle = bundles.find((bundle) => bundle.node.sku === selectedSku);
  const childBundles = bundles.filter(
    (bundle) =>
      bundle.node.sku !== selectedSku && bundle.node.itemType === "sub_assembly",
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      <FactoryProductSidebar
        products={products}
        filtered={filtered}
        query={query}
        phase={phase}
        selectedSku={selectedSku}
        onQueryChange={setQuery}
        onPhaseChange={setPhase}
        onSelectSku={setSelectedSku}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="p-8 text-zinc-500">Select a finished good.</div>
        ) : (
          <>
            <RecipeHeader
              selected={selected}
              bannerStatus={bannerStatus}
              liveCopied={liveCopied}
              isPending={isPending}
              estimate={estimate}
              onApprove={onApprove}
              onRecalculateEstimates={onRecalculateEstimates}
              onSaveEstimateOverrides={onSaveEstimateOverrides}
              onPublishKatana={async () => {
                const result = await publishApprovedRecipeToKatana(selectedSku);
                if (!result.ok) return { ok: false, error: result.error };
                return {
                  ok: true,
                  message:
                    "Catalog recipes posted (or dry-run) via POST /recipes",
                };
              }}
            />

            {error ? (
              <p className="px-6 py-2 text-sm text-rose-300">{error}</p>
            ) : null}

            <div className="border-b border-zinc-800 px-6 pb-3">
              <CadUploadDropzone
                globalSku={selected.sku}
                isPending={isPending}
                onDraftReady={() => {
                  void reload(selected.sku).then(() => {
                    toast.success("CAD draft BOM + estimates ready");
                    setBannerStatus("edited");
                  });
                }}
              />
            </div>

            <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
              {!tree || !rootBundle ? (
                <p className="text-sm text-zinc-500">
                  No draft recipe tree yet. Drop a .dae CAD file above, run the
                  heuristic seed, or add lines after selecting a finished good.
                </p>
              ) : (
                <BomAssemblyCard
                  node={rootBundle.node}
                  lines={rootBundle.lines}
                  ops={rootBundle.ops}
                  level={1}
                  defaultOpen
                  isPending={isPending}
                  isActiveAddTarget={activeParent === rootBundle.node.sku}
                  onActivate={() => setActiveParent(rootBundle.node.sku)}
                  materialCombobox={({ value, onChange, disabled }) => (
                    <MaterialCombobox
                      value={value}
                      disabled={disabled}
                      testId={
                        activeParent === rootBundle.node.sku
                          ? "factory-bom-material-combobox"
                          : `factory-bom-material-combobox-${rootBundle.node.sku}`
                      }
                      onChange={onChange}
                    />
                  )}
                  onSaveLine={onSaveLine}
                  onRemoveLine={onRemoveLine}
                  onAddLine={(data) => {
                    setActiveParent(data.parentSku);
                    onAddLine(data);
                  }}
                  onAddOp={onAddOp}
                  onRemoveOp={onRemoveOp}
                  nestedCards={childBundles.map((bundle) => (
                    <BomAssemblyCard
                      key={bundle.node.sku}
                      node={bundle.node}
                      lines={bundle.lines}
                      ops={bundle.ops}
                      level={2}
                      defaultOpen={
                        bundle.node.sku === activeParent ||
                        childBundles.length <= 2
                      }
                      isPending={isPending}
                      isActiveAddTarget={activeParent === bundle.node.sku}
                      onActivate={() => setActiveParent(bundle.node.sku)}
                      materialCombobox={({ value, onChange, disabled }) => (
                        <MaterialCombobox
                          value={value}
                          disabled={disabled}
                          testId={
                            activeParent === bundle.node.sku
                              ? "factory-bom-material-combobox"
                              : `factory-bom-material-combobox-${bundle.node.sku}`
                          }
                          onChange={onChange}
                        />
                      )}
                      onSaveLine={onSaveLine}
                      onRemoveLine={onRemoveLine}
                      onAddLine={(data) => {
                        setActiveParent(data.parentSku);
                        onAddLine(data);
                      }}
                      onAddOp={onAddOp}
                      onRemoveOp={onRemoveOp}
                    />
                  ))}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
