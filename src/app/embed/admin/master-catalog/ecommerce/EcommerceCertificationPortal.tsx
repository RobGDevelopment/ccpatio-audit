"use client";

import { CheckCircle2, ExternalLink, Lock, Palette, Shield } from "lucide-react";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
} from "@/lib/ecommerce-roster";

type Props = {
  miaApprovedCount: number;
  sowItemCount: number;
  canFullCatalog: boolean;
  onOpenFinishes: () => void;
  onOpenFullCatalog?: () => void;
  onOpenPrimeviewHandoff?: () => void;
};

/**
 * Compact Handoff & Certification strip for the GHL E-Commerce tab —
 * one place for Mia / Kian / Superadmin to certify finishes & jump to assets.
 */
export default function EcommerceCertificationPortal({
  miaApprovedCount,
  sowItemCount,
  canFullCatalog,
  onOpenFinishes,
  onOpenFullCatalog,
  onOpenPrimeviewHandoff,
}: Props) {
  const byFamily = {
    sunbrella: ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella").length,
    ultraleather: ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather").length,
    dekton: ECOMMERCE_32_FINISHES.filter((f) => f.family === "dekton").length,
    powder: ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder").length,
  };

  return (
    <section
      data-testid="ecommerce-certification-portal"
      className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-5 py-4 shadow-sm"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">
            Handoff &amp; Certification Portal
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            E-Commerce Single Source of Truth
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">
            Exact {ECOMMERCE_32_FINISH_COUNT} storefront finishes · system SKUs locked · frame policy
            on the banner below. Certify products, manage swatches &amp; 2048px textures, then export.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-900">
            <Shield className="h-3.5 w-3.5" />
            Mia · Kian · Superadmin certification lane
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mia Approved {miaApprovedCount}/{sowItemCount || "—"}
          </span>
          <button
            type="button"
            data-testid="open-32-finishes-btn"
            onClick={onOpenFinishes}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Palette className="h-3.5 w-3.5" />
            {ECOMMERCE_32_FINISH_COUNT} Finishes (+/−)
          </button>
          {onOpenPrimeviewHandoff ? (
            <button
              type="button"
              onClick={onOpenPrimeviewHandoff}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              PrimeView Export
              <ExternalLink className="h-3 w-3" />
            </button>
          ) : null}
          {canFullCatalog && onOpenFullCatalog ? (
            <button
              type="button"
              data-testid="superadmin-full-catalog-link"
              onClick={onOpenFullCatalog}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900"
            >
              Master Catalog / Mission Control
              <ExternalLink className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["Sunbrella", byFamily.sunbrella],
            ["Ultraleather", byFamily.ultraleather],
            ["Dekton (DKT-*)", byFamily.dekton],
            ["Powder (PWD-*)", byFamily.powder],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Lock className="h-3 w-3" />
        Finish SKUs are auto-generated and read-only. Use + / − to manage active rows; aliases record retirements.
      </p>
    </section>
  );
}
