"use client";

import Link from "next/link";
import { KatanaSyncButton } from "@/components/KatanaSyncButton";
import type { FactoryProductRow, RecipeEstimateRow } from "./actions";
import type { RecipeReviewStatus } from "@/server/db/schema";
import { EstimatePanel } from "./EstimatePanel";
import { statusClass, statusLabel } from "./factory-bom-ui";

type Props = {
  selected: FactoryProductRow;
  bannerStatus: RecipeReviewStatus | "none";
  liveCopied: boolean;
  isPending: boolean;
  estimate: RecipeEstimateRow | null;
  onApprove: () => void;
  onPublishKatana: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  onRecalculateEstimates: (forceOps: boolean) => void;
  onSaveEstimateOverrides: (patch: {
    weightLbs?: number;
    dimWeightLbs?: number;
    laborMinutes?: number;
    includePackagingBom?: boolean;
    applyEstimatedWeight?: boolean;
  }) => void;
};

export function RecipeHeader({
  selected,
  bannerStatus,
  liveCopied,
  isPending,
  estimate,
  onApprove,
  onPublishKatana,
  onRecalculateEstimates,
  onSaveEstimateOverrides,
}: Props) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          {selected.collection} · {selected.phaseSource}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-50">{selected.name}</h2>
        <p className="mt-1 font-mono text-xs text-zinc-500">{selected.sku}</p>
        <p className="mt-2 text-xs text-zinc-400">
          {selected.length ?? "—"} × {selected.depth ?? "—"} × {selected.height ?? "—"}
          {selected.msrp ? ` · ${selected.msrp}` : ""}
        </p>
        <EstimatePanel
          estimate={estimate}
          isPending={isPending}
          onRecalculate={onRecalculateEstimates}
          onSaveOverrides={onSaveEstimateOverrides}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <span
          data-testid="factory-bom-recipe-status"
          className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${statusClass(bannerStatus)}`}
        >
          {statusLabel(bannerStatus)}
        </span>
        {selected.liveBom || liveCopied ? (
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
          data-testid="factory-bom-approve"
          disabled={isPending || selected.draftLineCount === 0}
          onClick={onApprove}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 disabled:opacity-40"
        >
          Approve to live hub
        </button>
        <div data-testid="factory-bom-publish-katana">
          <KatanaSyncButton
            label="Publish recipes to Katana"
            secondaryLabel="Publishing recipes…"
            onSync={onPublishKatana}
          />
        </div>
      </div>
    </header>
  );
}
