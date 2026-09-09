"use client";

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useToast } from "@/app/admin/shared/ToastProvider";
import {
  approveDraftRecipe,
  deleteDraftBomLine,
  getDraftBomTree,
  listDraftLinesForParent,
  searchFactoryMaterials,
  upsertDraftBomLine,
  type BomComponentCandidate,
  type BomTreeNode,
  type DraftBomLine,
  type FactoryProductRow,
} from "./actions";
import type { RecipeReviewStatus } from "@/server/db/schema";

const INPUT =
  "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 shadow-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 focus:bg-zinc-900";

const UNIT_OPTIONS = [
  "ea",
  "ft",
  "yd",
  "lb",
  "lbs",
  "boardft",
  "slab",
  "sqft",
  "in",
] as const;

function statusLabel(status: RecipeReviewStatus | "none"): string {
  if (status === "draft_pending_review") return "Auto-generated";
  if (status === "edited") return "Edited";
  if (status === "factory_approved") return "Factory approved";
  return "No draft";
}

function statusClass(status: RecipeReviewStatus | "none"): string {
  if (status === "factory_approved") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "edited") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (status === "draft_pending_review") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function flattenTree(node: BomTreeNode): BomTreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function MaterialCombobox({
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
        aria-expanded={open}
        aria-controls={listboxId}
        value={query}
        disabled={disabled}
        placeholder="Search fabric, metal, foam, powder…"
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

export function FactoryBomWorkbench({ products }: { products: FactoryProductRow[] }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"all" | "1" | "2">("all");
  const [selectedSku, setSelectedSku] = useState(products[0]?.sku ?? "");
  const [tree, setTree] = useState<BomTreeNode | null>(null);
  const [activeParent, setActiveParent] = useState(selectedSku);
  const [lines, setLines] = useState<DraftBomLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [childSku, setChildSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [scrap, setScrap] = useState("1.0000");
  const [uom, setUom] = useState("ea");

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

  async function reload(sku: string): Promise<void> {
    const nextTree = await getDraftBomTree(sku);
    setTree(nextTree);
    const focus =
      nextTree && flattenTree(nextTree).some((n) => n.sku === activeParent)
        ? activeParent
        : sku;
    setActiveParent(focus);
    const nextLines = await listDraftLinesForParent(focus);
    setLines(nextLines);
  }

  useEffect(() => {
    if (!selectedSku) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const nextTree = await getDraftBomTree(selectedSku);
        if (cancelled) return;
        setTree(nextTree);
        setActiveParent(selectedSku);
        const nextLines = await listDraftLinesForParent(selectedSku);
        if (!cancelled) setLines(nextLines);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load draft BOM",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSku]);

  const parents = tree ? flattenTree(tree).filter((n) => n.depth === 0 || n.itemType === "sub_assembly") : [];

  function onSelectParent(sku: string): void {
    setActiveParent(sku);
    startTransition(async () => {
      setLines(await listDraftLinesForParent(sku));
    });
  }

  function onAdd(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await upsertDraftBomLine({
        parentSku: activeParent,
        childSku,
        quantity,
        scrapFactor: scrap,
        unitOfMeasure: uom,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setChildSku("");
      setQuantity("1");
      toast.success("Draft line saved");
      await reload(selectedSku);
    });
  }

  function onRemove(id: string): void {
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

  function onApprove(): void {
    if (!selectedSku) return;
    if (
      !window.confirm(
        `Copy the draft recipe for ${selectedSku} into live product_bom? Katana is not updated until catalog publish.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await approveDraftRecipe(selectedSku);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Draft copied to live product_bom");
      await reload(selectedSku);
    });
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="space-y-2 border-b border-zinc-800 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Phase 1 / 2 SKUs…"
            className={INPUT}
          />
          <div className="flex gap-1">
            {(["all", "1", "2"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPhase(value)}
                className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                  phase === value
                    ? "border-emerald-500/50 text-emerald-300"
                    : "border-zinc-800 text-zinc-500"
                }`}
              >
                {value === "all" ? "All" : `P${value}`}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-sm text-zinc-500">
              No VividWorks hub SKUs yet. Run{" "}
              <code className="font-mono text-zinc-300">
                npx tsx scripts/vividworks/07-generate-heuristic-boms.ts --live
              </code>
            </li>
          ) : (
            filtered.map((row) => (
              <li key={row.sku}>
                <button
                  type="button"
                  onClick={() => setSelectedSku(row.sku)}
                  className={`flex w-full flex-col items-start gap-1 border-l-2 px-4 py-3 text-left ${
                    row.sku === selectedSku
                      ? "border-emerald-500 bg-zinc-900"
                      : "border-transparent hover:bg-zinc-900/60"
                  }`}
                >
                  <span className="text-sm font-medium text-zinc-100">{row.name}</span>
                  <span className="font-mono text-[11px] text-zinc-500">{row.sku}</span>
                  <span
                    className={`mt-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusClass(row.reviewStatus)}`}
                  >
                    {statusLabel(row.reviewStatus)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="p-8 text-zinc-500">Select a finished good.</div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  {selected.collection} · {selected.phaseSource}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-50">{selected.name}</h2>
                <p className="mt-1 font-mono text-xs text-zinc-500">{selected.sku}</p>
                <p className="mt-2 text-xs text-zinc-400">
                  {selected.length ?? "—"} × {selected.depth ?? "—"} × {selected.height ?? "—"}
                  {selected.msrp ? ` · ${selected.msrp}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${statusClass(selected.reviewStatus)}`}
                >
                  {statusLabel(selected.reviewStatus)}
                </span>
                {selected.liveBom ? (
                  <span className="text-[11px] text-amber-300">
                    Live product_bom already has children
                  </span>
                ) : null}
                <Link
                  href={`/admin/dictionary/bom/${encodeURIComponent(selected.sku)}`}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Open live Dictionary BOM →
                </Link>
                <button
                  type="button"
                  disabled={isPending || selected.draftLineCount === 0}
                  onClick={onApprove}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 disabled:opacity-40"
                >
                  Approve to live hub
                </button>
              </div>
            </header>

            <div className="flex gap-2 overflow-x-auto border-b border-zinc-800 px-6 py-2">
              {parents.map((node) => (
                <button
                  key={node.sku}
                  type="button"
                  onClick={() => onSelectParent(node.sku)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs ${
                    node.sku === activeParent
                      ? "border-emerald-500/50 text-emerald-200"
                      : "border-zinc-800 text-zinc-400"
                  }`}
                >
                  {node.itemType === "finished_good" ? "FG" : node.sku.endsWith("-CUSH") ? "CUSH" : "FRAME"}
                  <span className="ml-2 font-mono text-[10px] text-zinc-500">{node.sku}</span>
                </button>
              ))}
            </div>

            {error ? (
              <p className="px-6 py-2 text-sm text-rose-300">{error}</p>
            ) : null}

            <div className="flex-1 overflow-auto px-6 py-4">
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="py-2">Child</th>
                    <th>Qty</th>
                    <th>Scrap</th>
                    <th>UOM</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-zinc-500">
                        No draft lines on this node. Add a raw material or run the heuristic script.
                      </td>
                    </tr>
                  ) : (
                    lines.map((line) => (
                      <tr key={line.id} className="border-t border-zinc-800">
                        <td className="py-3">
                          <div className="font-medium text-zinc-100">{line.childName}</div>
                          <div className="font-mono text-[11px] text-zinc-500">
                            {line.childSku} · {line.childItemType}
                          </div>
                          {line.notes ? (
                            <div className="mt-1 text-[11px] text-zinc-500">{line.notes}</div>
                          ) : null}
                        </td>
                        <td className="font-mono text-zinc-200">{line.quantity}</td>
                        <td className="font-mono text-zinc-400">{line.scrapFactor}</td>
                        <td className="uppercase text-zinc-400">{line.unitOfMeasure}</td>
                        <td>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(line.status)}`}>
                            {statusLabel(line.status)}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => onRemove(line.id)}
                            className="text-xs text-rose-300 hover:text-rose-200"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <form
              onSubmit={onAdd}
              className="grid grid-cols-1 gap-3 border-t border-zinc-800 px-6 py-4 md:grid-cols-12"
            >
              <div className="md:col-span-5">
                <MaterialCombobox
                  value={childSku}
                  onChange={(sku, hit) => {
                    setChildSku(sku);
                    if (hit?.uom) setUom(hit.uom.toLowerCase());
                  }}
                  disabled={isPending}
                />
              </div>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={`${INPUT} md:col-span-2`}
                placeholder="Qty"
              />
              <input
                value={scrap}
                onChange={(e) => setScrap(e.target.value)}
                className={`${INPUT} md:col-span-2`}
                placeholder="Scrap"
              />
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className={`${INPUT} md:col-span-2`}
              >
                {UNIT_OPTIONS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isPending || !childSku}
                className="rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-200 disabled:opacity-40 md:col-span-1"
              >
                Add
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
