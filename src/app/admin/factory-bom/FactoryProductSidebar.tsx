"use client";

import type { FactoryProductRow } from "./actions";
import type { RecipeReviewStatus } from "@/server/db/schema";
import {
  PIM_INPUT,
  card,
  statusClass,
  statusLabel,
  tactileIdle,
  tactilePressed,
} from "./factory-bom-ui";

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
    <aside className={`${card} flex w-80 shrink-0 flex-col overflow-hidden`}>
      <div className="space-y-2 border-b border-slate-100 p-4">
        <input
          data-testid="factory-bom-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search Phase 1 / 2 SKUs…"
          className={PIM_INPUT}
        />
        <div className="flex gap-2">
          {(["all", "1", "2"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onPhaseChange(value)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${
                phase === value ? tactilePressed : tactileIdle
              }`}
            >
              {value === "all" ? "All" : `P${value}`}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-sm text-slate-500">
            No VividWorks hub SKUs yet. Run{" "}
            <code className="font-mono text-slate-800">
              npx tsx scripts/vividworks/07-generate-heuristic-boms.ts --live
            </code>
          </li>
        ) : (
          filtered.map((row) => (
            <li key={row.sku} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                data-testid={`factory-bom-product-${row.sku}`}
                onClick={() => onSelectSku(row.sku)}
                className={`flex w-full flex-col items-start gap-1 border-l-2 px-4 py-3 text-left ${
                  row.sku === selectedSku
                    ? "border-slate-800 bg-slate-50"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <span className="text-sm font-medium text-slate-800">{row.name}</span>
                <span className="font-mono text-[11px] text-slate-500">{row.sku}</span>
                <span
                  className={`mt-1 ${statusClass(
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
