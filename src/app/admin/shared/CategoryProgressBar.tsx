"use client";

import type { BatchCompletionStats } from "@/app/admin/dictionary/pim-catalog-utils";

type Props = {
  stats: BatchCompletionStats;
};

export function CategoryProgressBar({ stats }: Props) {
  const { label, total, complete, percent } = stats;
  if (total === 0) return null;

  const tone =
    percent >= 90
      ? "bg-emerald-500"
      : percent >= 60
        ? "bg-amber-400"
        : "bg-rose-500";

  return (
    <div className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/95 px-3 py-2.5 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          <span className="font-medium text-slate-200">{label}</span>
          {": "}
          <span className="font-mono tabular-nums text-emerald-300/90">
            {percent}%
          </span>{" "}
          complete{" "}
          <span className="font-mono tabular-nums text-slate-500">
            ({complete}/{total} SKUs)
          </span>
        </p>
        <span className="text-[10px] uppercase tracking-wider text-slate-600">
          Data health sprint
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800/80"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${percent}% complete`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${tone}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
