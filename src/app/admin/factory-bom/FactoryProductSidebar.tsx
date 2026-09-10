"use client";

import type { FactoryProductRow } from "./actions";
import type { RecipeReviewStatus } from "@/server/db/schema";
import { PIM_INPUT, statusClass, statusLabel } from "./factory-bom-ui";

type Props = {
  products: FactoryProductRow[];
  filtered: FactoryProductRow[];
  query: string;
  phase: "all" | "1" | "2";
  selectedSku: string;
  onQueryChange: (value: string) => void;
  onPhaseChange: (value: "all" | "1" | "2") => void;
  onSelectSku: (sku: string) => void;
};

export function FactoryProductSidebar({
  filtered,
  query,
  phase,
  selectedSku,
  onQueryChange,
  onPhaseChange,
  onSelectSku,
}: Props) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="space-y-2 border-b border-zinc-800 p-3">
        <input
          data-testid="factory-bom-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search Phase 1 / 2 SKUs…"
          className={PIM_INPUT}
        />
        <div className="flex gap-1">
          {(["all", "1", "2"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onPhaseChange(value)}
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
                data-testid={`factory-bom-product-${row.sku}`}
                onClick={() => onSelectSku(row.sku)}
                className={`flex w-full flex-col items-start gap-1 border-l-2 px-4 py-3 text-left ${
                  row.sku === selectedSku
                    ? "border-emerald-500 bg-zinc-900"
                    : "border-transparent hover:bg-zinc-900/60"
                }`}
              >
                <span className="text-sm font-medium text-zinc-100">{row.name}</span>
                <span className="font-mono text-[11px] text-zinc-500">{row.sku}</span>
                <span
                  className={`mt-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusClass(
                    row.reviewStatus as RecipeReviewStatus | "none",
                  )}`}
                >
                  {statusLabel(row.reviewStatus)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
