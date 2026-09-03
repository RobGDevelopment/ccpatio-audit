"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  Fragment,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { deleteBOMLine, deleteItemOperation, getBomTree, getItemOperations, searchBomMaterials, upsertBOMLine, upsertItemOperation, type BomComponentCandidate, type BomTreeNode, type ItemOperationRow } from "@/app/admin/dictionary/actions";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { DeveloperFeedbackForm } from "@/app/admin/shared/DeveloperFeedbackForm";
import { DiscontinueButton } from "@/app/admin/shared/DiscontinueButton";

type BomPanelProps = {
  productSku: string;
  itemType: string;
};

type ChildDraft = {
  childSku: string;
  quantity: string;
  scrapFactor: string;
  unitOfMeasure: string;
};

type OpDraft = {
  workCenter: string;
  sequence: string;
  setupTimeMins: string;
  runTimeMins: string;
};

const UNIT_OPTIONS = ["ea", "in", "yd", "ft", "lbs", "sqft", "oz", "gal"] as const;

const INPUT =
  "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 shadow-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 focus:bg-zinc-900";

function flattenTree(node: BomTreeNode): BomTreeNode[] {
  const out: BomTreeNode[] = [node];
  for (const child of node.children) {
    out.push(...flattenTree(child));
  }
  return out;
}

function BomChildCombobox({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (sku: string, hit?: BomComponentCandidate) => void;
  disabled?: boolean;
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
      if (!query.trim()) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const rows = await searchBomMaterials(query);
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
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
        aria-expanded={open}
        aria-controls={listboxId}
        value={query}
        disabled={disabled}
        placeholder="Search raw / sub-assembly…"
        className={INPUT}
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
          className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-800/95 backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {loading ? (
            <li className="px-3 py-2 text-xs text-zinc-500">Searching…</li>
          ) : !query.trim() ? (
            <li className="px-3 py-2 text-xs text-zinc-500">Start typing to search raw materials...</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>
          ) : (
            visible.map((hit, idx) => {
              const prev = idx > 0 ? visible[idx - 1] : null;
              const cat = hit.category || "Uncategorized";
              const showHeader = !prev || (prev.category || "Uncategorized") !== cat;

              return (
                <Fragment key={hit.sku}>
                  {showHeader && (
                    <li className="bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                      {cat}
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={idx === highlightIndex}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-xs transition-colors duration-150 group cursor-pointer ${
                        idx === highlightIndex ? "bg-zinc-700/80" : "hover:bg-zinc-700/80"
                      }`}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onClick={() => select(hit)}
                    >
                      <span className="font-semibold text-zinc-100">{hit.name}</span>
                      <span className="font-mono text-zinc-500">
                        {hit.sku} · {hit.itemType}
                      </span>
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

function TreeRows({
  node,
  activeSku,
  onSelect,
}: {
  node: BomTreeNode;
  activeSku: string;
  onSelect: (sku: string) => void;
}) {
  const isActive = node.sku === activeSku;
  const indent = node.depth * 16;
  const qtyLabel =
    node.depth > 0 && node.quantity
      ? `${node.quantity}${node.scrapFactor && node.scrapFactor !== "1.0000" ? ` ×${node.scrapFactor}` : ""} ${node.unitOfMeasure ?? ""}`
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.sku)}
        className={`flex w-[calc(100%-16px)] items-center gap-3 py-2 mx-2 pr-3 text-left transition-colors duration-150 ${
          isActive
            ? "bg-zinc-900 text-emerald-50 border-l-2 border-emerald-500 shadow-sm rounded-r-md cursor-default relative"
            : "rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-l-2 border-transparent cursor-pointer"
        }`}
        style={{ paddingLeft: 12 + indent }}
      >
        <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          L{node.depth}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-sm text-zinc-100">{node.name}</span>
          <span className="block truncate font-mono text-[11px] text-zinc-500">
            {node.sku} · {node.itemType}
            {qtyLabel ? ` · ${qtyLabel}` : ""}
          </span>
        </span>
      </button>
      {node.children.map((child) => (
        <TreeRows
          key={`${child.lineId ?? child.sku}-${child.depth}`}
          node={child}
          activeSku={activeSku}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function BomPanel({ productSku, itemType }: BomPanelProps) {
  const toast = useToast();
  const [tree, setTree] = useState<BomTreeNode | null>(null);
  const [activeSku, setActiveSku] = useState(productSku);
  const [ops, setOps] = useState<ItemOperationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [childDraft, setChildDraft] = useState<ChildDraft>({
    childSku: "",
    quantity: "1",
    scrapFactor: "1.0000",
    unitOfMeasure: "ea",
  });
  const [opDraft, setOpDraft] = useState<OpDraft>({
    workCenter: "",
    sequence: "10",
    setupTimeMins: "",
    runTimeMins: "",
  });
  const [isPending, startTransition] = useTransition();

  const activeNode = useMemo(() => {
    if (!tree) return null;
    return flattenTree(tree).find((n) => n.sku === activeSku) ?? tree;
  }, [tree, activeSku]);

  const canEditActive =
    activeNode?.itemType === "finished_good" ||
    activeNode?.itemType === "sub_assembly";

  const reload = useCallback(async () => {
    if (!productSku.trim()) {
      setTree(null);
      setOps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextTree = await getBomTree(productSku);
      setTree(nextTree);
      const focus = activeSku || productSku;
      const opsRows = await getItemOperations(focus);
      setOps(opsRows);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load BOM",
      );
    } finally {
      setLoading(false);
    }
  }, [productSku, activeSku]);

  useEffect(() => {
    setActiveSku(productSku);
  }, [productSku]);

  useEffect(() => {
    void reload();
    // Initial + productSku change — avoid looping on activeSku via reload deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSku]);

  useEffect(() => {
    if (!activeSku) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getItemOperations(activeSku);
        if (!cancelled) setOps(rows);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSku]);

  function onAddChild(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canEditActive) return;
    setError(null);
    const childDraftSnapshot = { ...childDraft };
    startTransition(async () => {
      try {
        const result = await upsertBOMLine({
        parentSku: activeSku,
        childSku: childDraft.childSku,
        quantity: childDraft.quantity,
        scrapFactor: childDraft.scrapFactor,
        unitOfMeasure: childDraft.unitOfMeasure,
      });
      if (!result.ok) {
        setChildDraft(childDraftSnapshot);
        setError(result.error);
        if (result.error?.includes("Failed to find Server Action") || result.error?.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
        return;
      }
      setChildDraft((prev) => ({
        ...prev,
        childSku: "",
        quantity: "1",
        scrapFactor: "1.0000",
      }));
      const nextTree = await getBomTree(productSku);
      setTree(nextTree);
      } catch (err: unknown) {
        setChildDraft(childDraftSnapshot);
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(msg);
        if (msg.includes("Failed to find Server Action") || msg.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
      }
    });
  }

  function onRemoveChild(lineId: string): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteBOMLine(lineId);
      if (!result.ok) {
        setError(result.error);
        if (result.error?.includes("Failed to find Server Action") || result.error?.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
        return;
      }
      const nextTree = await getBomTree(productSku);
      setTree(nextTree);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(msg);
        if (msg.includes("Failed to find Server Action") || msg.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
      }
    });
  }

  function onAddOp(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canEditActive) return;
    setError(null);
    const opDraftSnapshot = { ...opDraft };
    startTransition(async () => {
      try {
        const result = await upsertItemOperation({
        itemSku: activeSku,
        workCenter: opDraft.workCenter,
        sequence: Number(opDraft.sequence) || 10,
        setupTimeMins: opDraft.setupTimeMins,
        runTimeMins: opDraft.runTimeMins,
      });
      if (!result.ok) {
        setOpDraft(opDraftSnapshot);
        setError(result.error);
        if (result.error?.includes("Failed to find Server Action") || result.error?.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
        return;
      }
      setOpDraft({
        workCenter: "",
        sequence: String((Number(opDraft.sequence) || 10) + 10),
        setupTimeMins: "",
        runTimeMins: "",
      });
      setOps(await getItemOperations(activeSku));
      } catch (err: unknown) {
        setOpDraft(opDraftSnapshot);
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(msg);
        if (msg.includes("Failed to find Server Action") || msg.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
      }
    });
  }

  function onRemoveOp(id: string): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteItemOperation(id);
      if (!result.ok) {
        setError(result.error);
        if (result.error?.includes("Failed to find Server Action") || result.error?.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
        return;
      }
      setOps(await getItemOperations(activeSku));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(msg);
        if (msg.includes("Failed to find Server Action") || msg.includes("digest")) {
          toast.error("System updated. Please refresh your page to continue saving.");
        }
      }
    });
  }

  const directChildren = activeNode?.children ?? [];

  return (
    <section className="h-full flex flex-col">

      {error ? (
        <div className="text-sm text-rose-500 bg-rose-500/10 p-2 rounded">{error}</div>
      ) : null}
      {loading ? (
        <div className="text-sm text-zinc-500">Loading BOM tree…</div>
      ) : !tree ? (
        <div className="text-sm text-zinc-500">Parent SKU not found.</div>
      ) : (
        <div className="flex h-full flex-row overflow-hidden">
          <div className="w-80 flex-shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col h-full overflow-y-auto shadow-[inset_-12px_0_24px_-12px_rgba(0,0,0,0.5)] pt-6 pb-6">
            <div className="mb-2 px-4 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Build Recipe
            </div>
            <div className="flex-1 overflow-y-auto">
              <TreeRows
                node={tree}
                activeSku={activeSku}
                onSelect={setActiveSku}
              />
            </div>
          </div>

          <div className="flex-1 bg-zinc-900 flex flex-col h-full overflow-y-auto relative shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.8)] z-10 p-8">
              <header className="sticky top-0 z-20 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 px-8 py-6 -mx-8 -mt-8 mb-8 flex justify-between items-start gap-4">
                <div className="flex flex-col gap-1 max-w-2xl">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-xs font-semibold tracking-widest text-emerald-500/80 uppercase">Currently Editing</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-50">{activeNode?.name || activeSku}</h1>
                    <span className="text-[11px] font-mono text-zinc-500 bg-zinc-950 px-2 py-1 rounded-md border border-zinc-800 uppercase tracking-widest mt-1">{activeSku}</span>
                  </div>
                  <div className="text-sm text-zinc-400 mt-1 mb-2">Define the materials, parts, and hardware required for this assembly.</div>
                  <div className="w-full">
                    <DeveloperFeedbackForm globalSku={activeSku} panelLocation="BOM Builder" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <DiscontinueButton globalSku={activeSku} />
                </div>
              </header>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">

              <ul className="mb-4 divide-y divide-zinc-900/80">
                {directChildren.length === 0 ? (
                  <li className="py-3 text-xs text-zinc-500">
                    No direct children on this node.
                  </li>
                ) : (
                  directChildren.map((child) => (
                    <li
                      key={child.lineId ?? child.sku}
                      className={`flex items-center justify-between gap-4 py-3 relative ${
                        child.itemType === 'sub_assembly' 
                          ? "bg-zinc-950/30 border border-zinc-800/80 rounded-lg p-4 ml-6 before:absolute before:-left-6 before:top-1/2 before:w-6 before:h-px before:bg-zinc-800 mb-2 mt-2" 
                          : "bg-transparent border-t border-dashed border-zinc-800/60 ml-12"
                      }`}
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="text-left font-semibold text-sm text-zinc-100 hover:text-emerald-400 block transition-colors"
                          onClick={() => setActiveSku(child.sku)}
                        >
                          {child.name}
                        </button>
                        <div className="font-mono text-[11px] text-zinc-500 mt-0.5">
                          {child.sku} · Qty {child.quantity} · Scrap {child.scrapFactor} ·{" "}
                          {child.unitOfMeasure}
                        </div>
                      </div>
                      {child.lineId ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => onRemoveChild(child.lineId!)}
                          className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded transition-colors disabled:opacity-50 active:scale-[0.98]"
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>

              <form
                onSubmit={onAddChild}
                className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_0.5fr_0.5fr_0.45fr_auto]"
              >
                <BomChildCombobox
                  value={childDraft.childSku}
                  disabled={isPending || !canEditActive}
                  onChange={(sku, hit) =>
                    setChildDraft((prev) => ({
                      ...prev,
                      childSku: sku,
                      unitOfMeasure:
                        hit?.uom?.toLowerCase() &&
                        UNIT_OPTIONS.includes(
                          hit.uom.toLowerCase() as (typeof UNIT_OPTIONS)[number],
                        )
                          ? hit.uom.toLowerCase()
                          : prev.unitOfMeasure,
                    }))
                  }
                />
                <div className="relative flex items-center">
                  <input
                    className={`${INPUT} w-24 tabular-nums pr-10 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500`}
                    placeholder="Qty"
                    inputMode="decimal"
                    disabled={isPending || !canEditActive}
                    value={childDraft.quantity}
                    onChange={(e) =>
                      setChildDraft((p) => ({ ...p, quantity: e.target.value }))
                    }
                  />
                  <span className="absolute right-3 text-xs font-medium text-zinc-500 pointer-events-none">Qty</span>
                </div>
                <div className="relative flex items-center">
                  <input
                    className={`${INPUT} w-24 tabular-nums pr-10 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500`}
                    placeholder="Scrap"
                    inputMode="decimal"
                    disabled={isPending || !canEditActive}
                    value={childDraft.scrapFactor}
                    onChange={(e) =>
                      setChildDraft((p) => ({
                        ...p,
                        scrapFactor: e.target.value,
                      }))
                    }
                  />
                  <span className="absolute right-3 text-[10px] font-medium text-zinc-500 pointer-events-none">Scrap</span>
                </div>
                <select
                  className={`${INPUT} appearance-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500`}
                  disabled={isPending || !canEditActive}
                  value={childDraft.unitOfMeasure}
                  onChange={(e) =>
                    setChildDraft((p) => ({
                      ...p,
                      unitOfMeasure: e.target.value,
                    }))
                  }
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u} className="bg-zinc-950">
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={
                    isPending || !canEditActive || !childDraft.childSku.trim()
                  }
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm ring-1 ring-emerald-500/50 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                >
                  + Add Material
                </button>
              </form>
            </div>

            <div>
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500 border-b border-zinc-800/60 pb-2">
                Routings · work centers
              </div>
              <ul className="mb-4 divide-y divide-zinc-900/80">
                {ops.length === 0 ? (
                  <li className="py-3 text-xs text-zinc-500">
                    No operations on this node.
                  </li>
                ) : (
                  ops.map((op) => (
                    <li
                      key={op.id}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <div>
                        <div className="font-mono text-[13px] text-zinc-100">
                          {op.sequence}. {op.workCenter}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          setup {op.setupTimeMins ?? "—"} min · run{" "}
                          {op.runTimeMins ?? "—"} min
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onRemoveOp(op.id)}
                        className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <form
                onSubmit={onAddOp}
                className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_0.4fr_0.5fr_0.5fr_auto]"
              >
                <input
                  className={INPUT}
                  placeholder="Work center"
                  disabled={isPending || !canEditActive}
                  value={opDraft.workCenter}
                  onChange={(e) =>
                    setOpDraft((p) => ({ ...p, workCenter: e.target.value }))
                  }
                />
                <input
                  className={INPUT}
                  placeholder="Seq"
                  inputMode="numeric"
                  disabled={isPending || !canEditActive}
                  value={opDraft.sequence}
                  onChange={(e) =>
                    setOpDraft((p) => ({ ...p, sequence: e.target.value }))
                  }
                />
                <input
                  className={INPUT}
                  placeholder="Setup min"
                  inputMode="decimal"
                  disabled={isPending || !canEditActive}
                  value={opDraft.setupTimeMins}
                  onChange={(e) =>
                    setOpDraft((p) => ({
                      ...p,
                      setupTimeMins: e.target.value,
                    }))
                  }
                />
                <input
                  className={INPUT}
                  placeholder="Run min"
                  inputMode="decimal"
                  disabled={isPending || !canEditActive}
                  value={opDraft.runTimeMins}
                  onChange={(e) =>
                    setOpDraft((p) => ({ ...p, runTimeMins: e.target.value }))
                  }
                />
                <button
                  type="submit"
                  disabled={
                    isPending || !canEditActive || !opDraft.workCenter.trim()
                  }
                  className="rounded-lg border border-zinc-700/80 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50"
                >
                  Add op
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {error ? <div className="mt-3 text-xs text-red-400">{error}</div> : null}
    </section>
  );
}
