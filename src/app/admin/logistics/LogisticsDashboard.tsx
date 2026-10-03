"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { LogoutButton } from "@/app/admin/LogoutButton";
import { handleInteractiveRowKeyDown } from "@/app/admin/shared/table-a11y";
import { useToast } from "@/app/admin/shared/ToastProvider";
import {
  getLogisticsProfiles,
  syncKatanaLogisticsProfiles,
  type LogisticsProfileRow,
  type LogisticsSettings,
} from "@/server/actions/logistics";
import { DeliverySettingsCard } from "./DeliverySettingsCard";
import { LogisticsProfileSheet } from "./LogisticsProfileSheet";

type Filter = "all" | "incomplete" | "ready";

type Props = {
  rows: LogisticsProfileRow[];
  settings: LogisticsSettings;
  operatorEmail: string | null;
};

function positive(value: string | null): boolean {
  if (!value) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function isReady(row: LogisticsProfileRow): boolean {
  return (
    positive(row.lengthIn) &&
    positive(row.widthIn) &&
    positive(row.heightIn) &&
    positive(row.weightLb) &&
    Boolean(row.ltlClass) &&
    row.leadTimeDays != null
  );
}

function formatMeasure(value: string | null): string {
  if (!value) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return String(numeric);
}

export function LogisticsDashboard({ rows, settings, operatorEmail }: Props) {
  const toast = useToast();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [localRows, setLocalRows] = useState(rows);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<LogisticsProfileRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, startSync] = useTransition();

  const stats = useMemo(() => {
    const ready = localRows.filter(isReady).length;
    return {
      total: localRows.length,
      ready,
      incomplete: localRows.length - ready,
      withAsset: localRows.filter((row) => row.asset3dUrl).length,
    };
  }, [localRows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return localRows.filter((row) => {
      if (filter === "ready" && !isReady(row)) return false;
      if (filter === "incomplete" && isReady(row)) return false;
      if (!needle) return true;
      return (
        row.variantSku.includes(needle) ||
        String(row.katanaVariantId).includes(needle) ||
        (row.ltlClass ?? "").includes(needle)
      );
    });
  }, [filter, localRows, query]);

  const openRow = (row: LogisticsProfileRow, target: HTMLElement) => {
    returnFocusRef.current = target;
    setSelected(row);
    setSheetOpen(true);
  };

  const sync = () => {
    setSyncError(null);
    startSync(async () => {
      const result = await syncKatanaLogisticsProfiles();
      if (!result.ok) {
        setSyncError(result.error);
        toast.error(result.error);
        return;
      }
      const next = await getLogisticsProfiles();
      setLocalRows(next);
      const conflictNote =
        result.conflicts.length > 0
          ? ` ${result.conflicts.length} SKU${result.conflicts.length === 1 ? "" : "s"} skipped because the Katana variant ID is already on another profile.`
          : "";
      toast.success(
        `Synced ${result.fetched} Katana variants. Created ${result.created} profiles.${conflictNote}`,
      );
    });
  };

  return (
    <div className="w-full px-2 py-4 sm:px-3">
      <header className="pim-glass mb-4 rounded-lg px-4 py-5 sm:px-5">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          CC Patio · Enterprise PIM Terminal
        </p>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Logistics &amp; Freight
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Katana owns the variant list. This catalog owns packaged length,
              width, height, weight, NMFC class, and lead time. Click a SKU to
              edit those fields. Sync adds missing SKUs and does not replace
              measurements already saved here.
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
            <div className="flex flex-wrap items-center gap-2">
              <LogoutButton />
              <button
                type="button"
                onClick={sync}
                disabled={isSyncing}
                className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {isSyncing ? "Syncing Katana…" : "Sync Katana Variants"}
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <Stat label="Profiles" value={String(stats.total)} />
              <Stat label="Ready" value={String(stats.ready)} />
              <Stat label="Incomplete" value={String(stats.incomplete)} />
              <Stat label="3D assets" value={String(stats.withAsset)} />
            </dl>
          </div>
        </div>
        {syncError ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {syncError}
          </p>
        ) : null}
      </header>

      <DeliverySettingsCard
        settings={settings}
        canSave={Boolean(operatorEmail)}
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["incomplete", "Incomplete"],
              ["ready", "Ready"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                filter === id
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search SKU, variant ID, or class"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/70 sm:max-w-xs"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <div className="max-h-[min(75vh,62rem)] overflow-auto">
          <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950">
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-3 font-medium">SKU</th>
                <th className="px-3 py-3 font-medium">Variant</th>
                <th className="px-3 py-3 font-medium">L × W × H (in)</th>
                <th className="px-3 py-3 font-medium">Weight</th>
                <th className="px-3 py-3 font-medium">NMFC</th>
                <th className="px-3 py-3 font-medium">Lead time</th>
                <th className="px-3 py-3 font-medium">3D asset</th>
                <th className="px-3 py-3 font-medium">Modular</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-zinc-500">
                    {localRows.length === 0
                      ? "No logistics profiles yet. Sync Katana variants to create placeholders."
                      : "No profiles match this filter."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const ready = isReady(row);
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer transition-colors hover:bg-zinc-900/35"
                      tabIndex={0}
                      role="button"
                      aria-label={`Edit logistics for ${row.variantSku}`}
                      onClick={(event) => openRow(row, event.currentTarget)}
                      onKeyDown={(event) =>
                        handleInteractiveRowKeyDown(event, () =>
                          openRow(row, event.currentTarget),
                        )
                      }
                    >
                      <td className="px-3 py-2.5 font-mono text-[12px] text-zinc-100">
                        {row.variantSku}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">
                        {row.katanaVariantId}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-zinc-300">
                        {formatMeasure(row.lengthIn)} × {formatMeasure(row.widthIn)} ×{" "}
                        {formatMeasure(row.heightIn)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-zinc-300">
                        {row.weightLb ? `${formatMeasure(row.weightLb)} lb` : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-300">
                        {row.ltlClass ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-zinc-300">
                        {row.leadTimeDays == null ? "—" : `${row.leadTimeDays} d`}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2.5 font-mono text-[11px] text-zinc-500">
                        {row.asset3dUrl ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-400">
                        {row.isModularComponent ? "Yes" : "No"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            ready
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                          }`}
                        >
                          {ready ? "Ready" : "Incomplete"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LogisticsProfileSheet
        row={selected}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        returnFocusRef={returnFocusRef}
        onSaved={(profile) => {
          setLocalRows((prev) =>
            prev.map((row) => (row.id === profile.id ? profile : row)),
          );
          setSelected(profile);
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}
