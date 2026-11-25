"use client";

import { AlertTriangle, X } from "lucide-react";

export type ArchiveImpactTarget =
  | { kind: "finish"; sku: string; displayName: string }
  | { kind: "product"; sku: string; productName: string; listingId?: string };

type Props = {
  open: boolean;
  target: ArchiveImpactTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
};

export default function ArchiveImpactModal({
  open,
  target,
  onCancel,
  onConfirm,
  busy = false,
}: Props) {
  if (!open || !target) return null;

  const title =
    target.kind === "finish"
      ? `Archive finish ${target.sku}?`
      : `Archive product ${target.sku}?`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="archive-impact-modal">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-amber-500/30 bg-[#111827] p-6 text-slate-100 shadow-2xl">
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-3 top-3 rounded-full p-1 text-slate-400 hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-400" />
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm text-slate-300">
              {target.kind === "finish" ? target.displayName : target.productName}
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-amber-100/90">
              <li>Hub row stays in PostgreSQL — SKU is preserved (no hard delete).</li>
              <li>WooCommerce will not receive a destructive DELETE from this action.</li>
              <li>
                Storefront swatch / variation visibility may drop until you restore from{" "}
                <strong>Archived / Disabled</strong>.
              </li>
              <li>Change stages into the Pending Commit Bar — nothing applies until you commit.</li>
            </ul>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            data-testid="archive-impact-confirm"
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? "Staging…" : "Stage Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}