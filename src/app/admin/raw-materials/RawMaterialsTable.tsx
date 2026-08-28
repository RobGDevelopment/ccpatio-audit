"use client";

import {
  Fragment,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  createRawMaterial,
  deleteRawMaterial,
  syncRawMaterialToKatanaAction,
  updateRawMaterial,
  type RawMaterialRow,
} from "./actions";
import { KatanaSyncButton } from "@/components/KatanaSyncButton";

type Props = {
  rows: RawMaterialRow[];
};

type MaterialDraft = {
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPerUnit: string;
};

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

const UNIT_OPTIONS = ["ea", "in", "yd", "ft", "lbs", "sqft", "oz", "gal"] as const;

const INPUT =
  "w-full border-b border-transparent bg-transparent py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors hover:border-zinc-700 focus:border-emerald-500";

function emptyDraft(): MaterialDraft {
  return {
    sku: "",
    name: "",
    category: "Fabric",
    unitOfMeasure: "ea",
    costPerUnit: "",
  };
}

function draftFromRow(row: RawMaterialRow): MaterialDraft {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    unitOfMeasure: row.unitOfMeasure,
    costPerUnit: row.costPerUnit ?? "",
  };
}

export function RawMaterialsTable({ rows }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [localRows, setLocalRows] = useState(rows);
  const [createDraft, setCreateDraft] = useState<MaterialDraft>(emptyDraft);
  const [editDrafts, setEditDrafts] = useState<Record<string, MaterialDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return localRows;
    }
    return localRows.filter(
      (row) =>
        row.sku.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle),
    );
  }, [localRows, query]);

  function onCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRawMaterial(createDraft);
      if (!result.ok || !result.material) {
        setError(result.ok ? "Create failed" : result.error);
        return;
      }
      setLocalRows((prev) =>
        [...prev, result.material!].sort((a, b) =>
          a.sku.localeCompare(b.sku),
        ),
      );
      setCreateDraft(emptyDraft());
    });
  }

  function onUpdate(id: string, event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const draft = editDrafts[id];
    if (!draft) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateRawMaterial(id, draft);
      if (!result.ok || !result.material) {
        setError(result.ok ? "Update failed" : result.error);
        return;
      }
      setLocalRows((prev) =>
        prev.map((row) => (row.id === id ? result.material! : row)),
      );
      setExpanded((prev) => ({ ...prev, [id]: false }));
    });
  }

  function onDelete(id: string): void {
    if (!window.confirm("Delete this raw material?")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteRawMaterial(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLocalRows((prev) => prev.filter((row) => row.id !== id));
    });
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1 sm:max-w-lg">
          <span className="sr-only">Filter raw materials</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by SKU, name, or category…"
            className="w-full border-b border-zinc-800 bg-transparent py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors hover:border-zinc-600 focus:border-emerald-500"
          />
        </label>
        <p className="text-xs tabular-nums text-zinc-500">
          {filtered.length} of {localRows.length} materials
        </p>
      </div>

      <form
        onSubmit={onCreate}
        className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4"
      >
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          Add raw material
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input
            value={createDraft.sku}
            onChange={(e) =>
              setCreateDraft((prev) => ({ ...prev, sku: e.target.value }))
            }
            placeholder="SKU"
            className={`${INPUT} font-mono`}
            disabled={isPending}
          />
          <input
            value={createDraft.name}
            onChange={(e) =>
              setCreateDraft((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Name"
            className={INPUT}
            disabled={isPending}
          />
          <select
            value={createDraft.category}
            onChange={(e) =>
              setCreateDraft((prev) => ({ ...prev, category: e.target.value }))
            }
            className={`${INPUT} appearance-none`}
            disabled={isPending}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category} className="bg-zinc-950">
                {category}
              </option>
            ))}
          </select>
          <select
            value={createDraft.unitOfMeasure}
            onChange={(e) =>
              setCreateDraft((prev) => ({
                ...prev,
                unitOfMeasure: e.target.value,
              }))
            }
            className={`${INPUT} appearance-none`}
            disabled={isPending}
          >
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit} className="bg-zinc-950">
                {unit}
              </option>
            ))}
          </select>
          <input
            value={createDraft.costPerUnit}
            onChange={(e) =>
              setCreateDraft((prev) => ({
                ...prev,
                costPerUnit: e.target.value,
              }))
            }
            placeholder="Cost / unit"
            inputMode="decimal"
            className={`${INPUT} font-mono`}
            disabled={isPending}
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            Add
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="border-b border-zinc-800/80 bg-zinc-950/60">
            <tr className="text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="w-10 px-3 py-3" />
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">UOM</th>
              <th className="px-4 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900/70">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                  No raw materials match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const isOpen = Boolean(expanded[row.id]);
                const editDraft = editDrafts[row.id] ?? draftFromRow(row);
                return (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => {
                            setExpanded((prev) => ({
                              ...prev,
                              [row.id]: !prev[row.id],
                            }));
                            setEditDrafts((prev) => ({
                              ...prev,
                              [row.id]: draftFromRow(row),
                            }));
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center text-zinc-500 transition hover:text-zinc-200"
                        >
                          <span
                            className={`block text-xs transition-transform ${
                              isOpen ? "rotate-180" : ""
                            }`}
                          >
                            ▾
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-zinc-100">
                        {row.sku}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{row.name}</td>
                      <td className="px-4 py-3 text-zinc-400">{row.category}</td>
                      <td className="px-4 py-3 text-zinc-400">{row.unitOfMeasure}</td>
                      <td className="px-4 py-3 font-mono text-zinc-400">
                        {row.costPerUnit ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onDelete(row.id)}
                          disabled={isPending}
                          className="text-xs text-zinc-500 transition hover:text-red-400 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-4">
                          <form
                            onSubmit={(event) => onUpdate(row.id, event)}
                            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
                          >
                            <input
                              value={editDraft.sku}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...editDraft,
                                    sku: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} font-mono`}
                              disabled={isPending}
                            />
                            <input
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...editDraft,
                                    name: e.target.value,
                                  },
                                }))
                              }
                              className={INPUT}
                              disabled={isPending}
                            />
                            <select
                              value={editDraft.category}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...editDraft,
                                    category: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} appearance-none`}
                              disabled={isPending}
                            >
                              {CATEGORY_OPTIONS.map((category) => (
                                <option
                                  key={category}
                                  value={category}
                                  className="bg-zinc-950"
                                >
                                  {category}
                                </option>
                              ))}
                            </select>
                            <select
                              value={editDraft.unitOfMeasure}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...editDraft,
                                    unitOfMeasure: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} appearance-none`}
                              disabled={isPending}
                            >
                              {UNIT_OPTIONS.map((unit) => (
                                <option key={unit} value={unit} className="bg-zinc-950">
                                  {unit}
                                </option>
                              ))}
                            </select>
                            <input
                              value={editDraft.costPerUnit}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...editDraft,
                                    costPerUnit: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} font-mono`}
                              disabled={isPending}
                            />
                            <button
                              type="submit"
                              disabled={isPending}
                              className="rounded-lg border border-zinc-700/80 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-60"
                            >
                              Save changes
                            </button>
                            <KatanaSyncButton
                              label="Sync to Katana"
                              onSync={() =>
                                syncRawMaterialToKatanaAction(editDraft.sku)
                              }
                            />
                          </form>
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

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
