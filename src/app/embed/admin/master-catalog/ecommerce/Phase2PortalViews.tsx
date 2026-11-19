"use client";

import {
  PHASE2_SUBFILTER_LABELS,
  phase2BadgesForRow,
  type Phase2SubFilter,
} from "@/server/ecommerce/two-tab-portal";
import { bomBadgeLabel, isReadyToPromote } from "@/server/ecommerce/phase2-hydration";
import { isProvisionalShell } from "@/server/ecommerce/provisional-shell";
import {
  classifyFramePolicy,
  computeAluMsrp,
  DEFAULT_ALU_UPCHARGE_PCT,
  FRAME_POLICY_ALU10,
} from "@/server/ecommerce/alu10-pricing";
import type { EcommerceListing } from "../actions";

export type Phase2Listing = EcommerceListing & {
  attributes?: Record<string, unknown> | null;
  syncToWoo?: boolean;
};

export function Phase2SubFilterBar({
  filter,
  onChange,
  counts,
}: {
  filter: Phase2SubFilter;
  onChange: (f: Phase2SubFilter) => void;
  counts: Partial<Record<Phase2SubFilter, number>>;
}) {
  const keys: Phase2SubFilter[] = [
    "phase2_sow",
    "hub_library",
    "ready_to_promote",
    "needs_fields",
  ];
  return (
    <div className="flex flex-wrap gap-2" data-testid="phase2-subfilters">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`phase2-filter-${key}`}
          onClick={() => onChange(key)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
            filter === key
              ? "border-violet-700 bg-violet-700 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"
          }`}
        >
          {PHASE2_SUBFILTER_LABELS[key]}
          {typeof counts[key] === "number" ? ` · ${counts[key]}` : ""}
        </button>
      ))}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {label}
    </span>
  );
}

export function Phase2StagingGrid({
  listings,
  onPromote,
  onHeal,
}: {
  listings: Phase2Listing[];
  onPromote: (sku: string) => void;
  onHeal: (sku: string) => void;
}) {
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white" data-testid="phase2-grid">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Steel Base</th>
            <th className="px-3 py-2">Woo Aluminum (+10%)</th>
            <th className="px-3 py-2">Readiness</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((row) => {
            const badges = phase2BadgesForRow({
              globalSku: row.globalSku,
              productName: row.productName,
              syncToWoo: row.syncToWoo ?? false,
              msrpValue: row.msrpValue,
              hubLength: row.hubLength,
              hubDepth: row.hubDepth,
              hubHeight: row.hubHeight,
              hubWeight: row.hubWeight,
              attributes: row.attributes,
            });
            const provisional = isProvisionalShell(row.attributes);
            const policy = classifyFramePolicy({
              globalSku: row.globalSku,
              isThirdParty: Boolean(row.thirdParty),
              attributes: row.attributes,
            });
            const alu =
              row.aluminumMsrpValue ??
              (row.msrpValue != null && policy === FRAME_POLICY_ALU10
                ? computeAluMsrp(row.msrpValue, DEFAULT_ALU_UPCHARGE_PCT)
                : row.msrpValue);
            return (
              <tr key={row.id} className="border-t border-slate-100" data-testid={`phase2-row-${row.globalSku}`}>
                <td className="px-3 py-2 font-medium text-slate-800">{row.productName}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.globalSku}</td>
                <td className="px-3 py-2">
                  {row.msrpValue != null ? `$${row.msrpValue.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-800">
                  {alu != null ? `$${alu.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge ok={badges.price} label="Price" />
                    <Badge ok={badges.dims} label="Dims" />
                    <Badge ok={badges.weight} label="Weight" />
                    <Badge ok={badges.options} label="Options" />
                    <Badge
                      ok={badges.bom === "ready"}
                      label={bomBadgeLabel(badges.bom, provisional)}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => onHeal(row.globalSku)}
                    >
                      Heal & Link Katana
                    </button>
                    <button
                      type="button"
                      disabled={!isReadyToPromote(badges)}
                      className="rounded-lg bg-sky-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      onClick={() => onPromote(row.globalSku)}
                    >
                      Promote to Live
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {listings.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                No staging rows for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LiveToolbar({
  subView,
  onSubView,
  approvedCount,
  totalVisible,
  onApproveAll,
  search,
  onSearch,
  collection,
  onCollection,
  collections,
}: {
  subView: "grouped_parents" | "sheet_grid";
  onSubView: (v: "grouped_parents" | "sheet_grid") => void;
  approvedCount: number;
  totalVisible: number;
  onApproveAll: () => void;
  search: string;
  onSearch: (v: string) => void;
  collection: string;
  onCollection: (v: string) => void;
  collections: string[];
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="live-ecommerce-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="live-view-grouped"
          onClick={() => onSubView("grouped_parents")}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
            subView === "grouped_parents" ? "bg-sky-700 text-white" : "bg-white border border-slate-200 text-slate-700"
          }`}
        >
          Grouped Parents
        </button>
        <button
          type="button"
          data-testid="live-view-sheet"
          onClick={() => onSubView("sheet_grid")}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
            subView === "sheet_grid" ? "bg-sky-700 text-white" : "bg-white border border-slate-200 text-slate-700"
          }`}
        >
          Sheet Grid
        </button>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800" data-testid="mia-approved-count">
          Mia Approved: {approvedCount} / {totalVisible}
        </span>
        <button
          type="button"
          data-testid="approve-all-visible"
          onClick={onApproveAll}
          className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Approve All Visible
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="live-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search live catalog…"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        />
        <select
          data-testid="live-collection"
          value={collection}
          onChange={(e) => onCollection(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">All Collections</option>
          {collections.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
