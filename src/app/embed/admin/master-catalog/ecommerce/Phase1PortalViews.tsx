"use client";

import { useMemo, useState } from "react";
import {
  PHASE1_LAUNCH_BANNER,
  PHASE1_VIEW_LABELS,
  shippingClassFromLb,
  type Phase1PortalView,
} from "@/server/ecommerce/phase1-portal";
import type { EcommerceListing } from "../actions";
import type { WooSyncStatus } from "@/server/woocommerce/woo-catalog-sync";

export type Phase1Listing = EcommerceListing & {
  miaApproved?: boolean;
  miaApprovedAt?: string | null;
  wooSyncStatus?: WooSyncStatus;
};

const VIEW_KEYS: Phase1PortalView[] = [
  "phase1_parents",
  "phase1_flat",
  "finishes_addons",
  "all_hub",
];

function wooDotClass(status: WooSyncStatus | undefined): string {
  switch (status) {
    case "synced":
      return "bg-emerald-500";
    case "dirty":
      return "bg-amber-400";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-slate-300";
  }
}

function wooTitle(status: WooSyncStatus | undefined): string {
  switch (status) {
    case "synced":
      return "Synced to Woo";
    case "dirty":
      return "Modified in Hub — Needs Push";
    case "error":
      return "Last Sync Error";
    default:
      return "Not Pushed Yet";
  }
}

export function Phase1ViewSwitcher({
  view,
  onChange,
  approvedCount,
  totalSow,
}: {
  view: Phase1PortalView;
  onChange: (view: Phase1PortalView) => void;
  approvedCount: number;
  totalSow: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {PHASE1_LAUNCH_BANNER}
      </span>
      <span className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
        Approved: {approvedCount} / {totalSow || 102}
      </span>
      <div className="flex w-full flex-wrap gap-2">
        {VIEW_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              view === key
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
            }`}
          >
            {PHASE1_VIEW_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Phase1FlatGrid({
  listings,
  onToggleMia,
  onPush,
}: {
  listings: Phase1Listing[];
  onToggleMia: (sku: string, approved: boolean) => void;
  onPush: (sku: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...listings].sort((a, b) => a.sheetOrder - b.sheetOrder || a.globalSku.localeCompare(b.globalSku)),
    [listings],
  );

  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Product</th>
            <th className="px-2 py-2">Woo SKU</th>
            <th className="px-2 py-2">SOW Base</th>
            <th className="px-2 py-2">Woo Regular</th>
            <th className="px-2 py-2">Sale</th>
            <th className="px-2 py-2">Dims</th>
            <th className="px-2 py-2">Weight</th>
            <th className="px-2 py-2">Ship Class</th>
            <th className="px-2 py-2">Mia</th>
            <th className="px-2 py-2">Woo</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const weight = row.hubWeight ? Number(row.hubWeight) : 0;
            const ship = shippingClassFromLb(Number.isFinite(weight) ? weight : 0);
            const dims = [row.hubLength, row.hubDepth, row.hubHeight]
              .filter(Boolean)
              .join(" × ");
            return (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-2 py-2 tabular-nums text-slate-400">{idx + 1}</td>
                <td className="px-2 py-2 font-medium text-slate-800">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    {row.productName}
                  </button>
                  {expanded === row.id ? (
                    <p className="mt-1 text-[10px] text-slate-500">
                      {row.collectionLabel} · {row.thirdParty ? "Resale" : "Make"}
                      {row.hubArmHeight ? ` · Arm ${row.hubArmHeight}` : ""}
                      {row.hubSitHeight ? ` · Seat ${row.hubSitHeight}` : ""}
                    </p>
                  ) : null}
                </td>
                <td className="px-2 py-2 font-mono text-[11px]">{row.globalSku}</td>
                <td className="px-2 py-2">{row.msrp}</td>
                <td className="px-2 py-2">{row.msrp}</td>
                <td className="px-2 py-2">{row.salePrice ?? "—"}</td>
                <td className="px-2 py-2">{dims || "—"}</td>
                <td className="px-2 py-2">{row.hubWeight ? `${row.hubWeight} lb` : "—"}</td>
                <td className="px-2 py-2 font-mono">{ship}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(row.miaApproved)}
                    onClick={() => onToggleMia(row.globalSku, !row.miaApproved)}
                    className={`h-5 w-9 rounded-full p-0.5 ${
                      row.miaApproved ? "bg-emerald-600" : "bg-slate-200"
                    }`}
                    title="Mia Approved"
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition ${
                        row.miaApproved ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </td>
                <td className="px-2 py-2">
                  <span
                    title={wooTitle(row.wooSyncStatus)}
                    className={`inline-block h-3 w-3 rounded-full ${wooDotClass(row.wooSyncStatus)}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onPush(row.globalSku)}
                    className="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    Push to Woo
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { wooDotClass, wooTitle };
