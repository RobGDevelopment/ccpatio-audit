"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { LogoutButton } from "../LogoutButton";
import type { RawMaterialRow } from "./actions";
import {
  RawMaterialsTable,
  type FilteredStats,
} from "./RawMaterialsTable";

type Props = {
  rows: RawMaterialRow[];
  operatorEmail?: string | null;
};

export function RawMaterialsPageClient({ rows, operatorEmail }: Props) {
  const initialStats = useMemo((): FilteredStats => {
    const categories = new Set(rows.map((row) => row.category || "Uncategorized"));
    return {
      materials: rows.length,
      categories: categories.size,
      withCost: rows.filter((row) => row.costPerUnit).length,
    };
  }, [rows]);

  const [stats, setStats] = useState<FilteredStats>(initialStats);

  const onFilteredStatsChange = useCallback((next: FilteredStats) => {
    setStats(next);
  }, []);

  return (
    <div className="w-full px-2 py-4 sm:px-3">
      <header className="pim-glass mb-4 rounded-lg px-4 py-5 sm:px-5">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          CC Patio · Enterprise PIM Terminal
        </p>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Raw Materials Catalog
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Manage fabrics, aluminum, powder coat, and sub-assemblies used in
              Bill of Materials linkage. Changes sync bidirectionally with the
              Global SKU Dictionary.
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-4 text-xs">
              <Link
                href="/"
                className="text-emerald-400/90 transition hover:text-emerald-300"
              >
                ← Back to Launchpad
              </Link>
              <Link
                href="/admin/dictionary"
                className="text-zinc-400 transition hover:text-zinc-200"
              >
                Global SKU Dictionary →
              </Link>
              <Link
                href="/admin/audit"
                className="text-zinc-400 transition hover:text-zinc-200"
              >
                Change log →
              </Link>
              {operatorEmail ? (
                <span className="text-zinc-500">
                  Signed in as{" "}
                  <span className="font-mono text-emerald-300/90">
                    {operatorEmail}
                  </span>
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <LogoutButton />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <Stat label="Materials" value={String(stats.materials)} />
              <Stat label="Categories" value={String(stats.categories)} />
              <Stat
                label="With cost"
                value={String(stats.withCost)}
                tone={stats.withCost > 0 ? "ok" : "warn"}
              />
            </dl>
          </div>
        </div>
        <div
          aria-hidden
          className="relative mt-6 h-px w-full overflow-hidden bg-zinc-800/80"
        >
          <div className="animate-beam-glide absolute top-0 left-0 h-full w-1/4 bg-linear-to-r from-transparent via-emerald-500/40 to-transparent" />
        </div>
      </header>

      <div className="pim-glass overflow-hidden rounded-lg">
        <RawMaterialsTable
          rows={rows}
          onFilteredStatsChange={onFilteredStatsChange}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "ok";
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-200"
      : tone === "ok"
        ? "text-emerald-300"
        : "text-zinc-50";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 transition-all hover:bg-zinc-900 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] cursor-pointer">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${valueClass}`}
      >
        {value}
      </dd>
    </div>
  );
}
