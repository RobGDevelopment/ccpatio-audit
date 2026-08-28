"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  deleteBOMLine,
  deleteItemOperation,
  getBomTree,
  getItemOperations,
  searchBomComponents,
  upsertBOMLine,
  upsertItemOperation,
  type BomComponentCandidate,
  type BomTreeNode,
  type ItemOperationRow,
} from "@/app/admin/dictionary/actions";

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
  "w-full border-b border-transparent bg-transparent py-1.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors hover:border-zinc-700 focus:border-emerald-500";

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
      setLoading(true);
      try {
        const rows = await searchBomComponents(query);
        if (!cancelled) {
          setOptions(rows);
          setHighlightIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
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

  const visible = useMemo(() => options.slice(0, 12), [options]);

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
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 py-1 shadow-xl"
        >
          {loading ? (
            <li className="px-3 py-2 text-xs text-zinc-500">Searching…</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>
          ) : (
            visible.map((hit, idx) => (
              <li key={hit.sku}>
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlightIndex}
                  className={`flex w-full flex-col px-3 py-2 text-left text-xs ${
                    idx === highlightIndex ? "bg-zinc-800" : "hover:bg-zinc-900"
                  }`}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => select(hit)}
                >
                  <span className="font-mono text-zinc-100">{hit.sku}</span>
                  <span className="text-zinc-500">
                    {hit.category ? `${hit.category} · ` : ""}{hit.name} · {hit.itemType}
                  </span>
                </button>
              </li>
            ))
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
        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
          isActive
            ? "bg-emerald-500/10 text-emerald-300"
            : "text-zinc-300 hover:bg-zinc-900/60"
        }`}
        style={{ paddingLeft: 8 + indent }}
      >
        <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          L{node.depth}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[13px]">{node.sku}</span>
          <span className="block truncate text-[11px] text-zinc-500">
            {node.name} · {node.itemType}
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
    startTransition(async () => {
      const result = await upsertBOMLine({
        parentSku: activeSku,
        childSku: childDraft.childSku,
        quantity: childDraft.quantity,
        scrapFactor: childDraft.scrapFactor,
        unitOfMeasure: childDraft.unitOfMeasure,
      });
      if (!result.ok) {
        setError(result.error);
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
    });
  }

  function onRemoveChild(lineId: string): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteBOMLine(lineId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const nextTree = await getBomTree(productSku);
      setTree(nextTree);
    });
  }

  function onAddOp(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canEditActive) return;
    setError(null);
    startTransition(async () => {
      const result = await upsertItemOperation({
        itemSku: activeSku,
        workCenter: opDraft.workCenter,
        sequence: Number(opDraft.sequence) || 10,
        setupTimeMins: opDraft.setupTimeMins,
        runTimeMins: opDraft.runTimeMins,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpDraft({
        workCenter: "",
        sequence: String((Number(opDraft.sequence) || 10) + 10),
        setupTimeMins: "",
        runTimeMins: "",
      });
      setOps(await getItemOperations(activeSku));
    });
  }

  function onRemoveOp(id: string): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteItemOperation(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOps(await getItemOperations(activeSku));
    });
  }

  const directChildren = activeNode?.children ?? [];

  return (
    <section className="mt-8 border-t border-zinc-800/80 pt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-300">
            Multi-Level BOM &amp; Routings
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Tree for{" "}
            <span className="font-mono text-zinc-400">{productSku}</span>
            <span className="text-zinc-600"> · {itemType}</span>. Select a node
            to add children or work-center operations.
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-500 bg-rose-500/10 p-2 rounded">{error}</p>
      ) : null}
      {loading ? (
        <p className="text-sm text-zinc-500">Loading BOM tree…</p>
      ) : !tree ? (
        <p className="text-sm text-zinc-500">Parent SKU not found.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Hierarchy L0 → L2+
            </p>
            <div className="max-h-80 overflow-y-auto">
              <TreeRows
                node={tree}
                activeSku={activeSku}
                onSelect={setActiveSku}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Builder ·{" "}
                  <span className="font-mono text-zinc-300">{activeSku}</span>
                </p>
                {!canEditActive ? (
                  <span className="text-[11px] text-amber-500/80">
                    Select a finished_good or sub_assembly node
                  </span>
                ) : null}
              </div>

              <ul className="mb-3 divide-y divide-zinc-900/80">
                {directChildren.length === 0 ? (
                  <li className="py-3 text-xs text-zinc-500">
                    No direct children on this node.
                  </li>
                ) : (
                  directChildren.map((child) => (
                    <li
                      key={child.lineId ?? child.sku}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="font-mono text-[13px] text-zinc-100 hover:text-emerald-400"
                          onClick={() => setActiveSku(child.sku)}
                        >
                          {child.sku}
                        </button>
                        <p className="text-[11px] text-zinc-500">
                          qty {child.quantity} · scrap {child.scrapFactor} ·{" "}
                          {child.unitOfMeasure}
                        </p>
                      </div>
                      {child.lineId ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => onRemoveChild(child.lineId!)}
                          className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
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
                <input
                  className={INPUT}
                  placeholder="Qty"
                  inputMode="decimal"
                  disabled={isPending || !canEditActive}
                  value={childDraft.quantity}
                  onChange={(e) =>
                    setChildDraft((p) => ({ ...p, quantity: e.target.value }))
                  }
                />
                <input
                  className={INPUT}
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
                <select
                  className={`${INPUT} appearance-none`}
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
                  className="rounded-lg border border-zinc-700/80 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50"
                >
                  Add child
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Routings · work centers
              </p>
              <ul className="mb-3 divide-y divide-zinc-900/80">
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
                        <p className="font-mono text-[13px] text-zinc-100">
                          {op.sequence}. {op.workCenter}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          setup {op.setupTimeMins ?? "—"} min · run{" "}
                          {op.runTimeMins ?? "—"} min
                        </p>
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

      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
