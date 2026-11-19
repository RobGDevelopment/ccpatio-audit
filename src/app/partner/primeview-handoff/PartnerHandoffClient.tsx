"use client";

import { Download } from "lucide-react";
import type { LiveStorefrontRow } from "@/server/woocommerce/handoff-spec-generator";
import { PHASE1_FABRICS, PHASE1_POWDERS } from "@/server/ecommerce/phase1-portal";
import {
  PHASE1_FABRIC_DISPLAY_NAMES,
  PHASE1_POWDER_DISPLAY_NAMES,
} from "@/server/woocommerce/finish-keys";

type Props = {
  token: string;
  generatedAtUtc: string;
  generatedAtMst: string;
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
  sowItemCount: number;
  parentCount: number;
  uniquePurchasableSkus: number;
  variationCount: number;
  simpleCount: number;
  webhookUrl: string;
  storefrontRows: LiveStorefrontRow[];
};

function downloadHref(artifact: "csv" | "spec" | "swatches", token: string) {
  return `/api/partner/primeview-handoff/download?artifact=${artifact}&token=${encodeURIComponent(token)}`;
}

export default function PartnerHandoffClient(props: Props) {
  return (
    <div className="min-h-screen bg-[#0f1419] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="border-b border-white/10 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
            CC Patio × PrimeView
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Phase 1 Handoff Portal
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Read-only self-serve downloads for Yardi on{" "}
            <span className="font-mono text-slate-300">ccpatiodev2.primeview.com</span>.
            No catalog edit, delete, or Katana/GHL mutation controls.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
              Mia Approved: {props.miaApprovedCount} / {props.sowItemCount}
            </span>
            <span className="text-xs text-slate-500">
              Last updated {props.generatedAtMst} MST ({props.generatedAtUtc})
              {props.miaLatestApprovedAt
                ? ` · latest approval ${props.miaLatestApprovedAt}`
                : ""}
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Parents</dt>
              <dd className="text-lg font-semibold text-white">{props.parentCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Variations</dt>
              <dd className="text-lg font-semibold text-white">{props.variationCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Simple</dt>
              <dd className="text-lg font-semibold text-white">{props.simpleCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Purchasable SKUs</dt>
              <dd className="text-lg font-semibold text-white">{props.uniquePurchasableSkus}</dd>
            </div>
          </dl>
        </header>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            1-click downloads
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href={downloadHref("csv", props.token)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Download className="h-4 w-4" />
              Download Live 169-Column WooCommerce CSV
            </a>
            <a
              href={downloadHref("spec", props.token)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
            >
              <Download className="h-4 w-4" />
              Download Live Technical Handoff Spec (.md)
            </a>
            <a
              href={downloadHref("swatches", props.token)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
            >
              <Download className="h-4 w-4" />
              Download 24 Fabric Swatches Manifest (.json)
            </a>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Production webhook:{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-slate-300">
              {props.webhookUrl}
            </code>
          </p>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              24 Fabric Swatches (Hub SKUs)
            </h2>
            <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/10">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#0f1419] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Display Name</th>
                  </tr>
                </thead>
                <tbody>
                  {PHASE1_FABRICS.map((sku) => (
                    <tr key={sku} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-mono text-amber-200/90">{sku}</td>
                      <td className="px-3 py-1.5 text-slate-300">
                        {PHASE1_FABRIC_DISPLAY_NAMES[sku] ?? sku}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              6 Powder-Coat Finishes (Hub SKUs)
            </h2>
            <div className="mt-3 overflow-auto rounded-xl border border-white/10">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-white/5 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Display Name</th>
                  </tr>
                </thead>
                <tbody>
                  {PHASE1_POWDERS.map((sku) => (
                    <tr key={sku} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-mono text-amber-200/90">{sku}</td>
                      <td className="px-3 py-1.5 text-slate-300">
                        {PHASE1_POWDER_DISPLAY_NAMES[sku] ?? sku}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Map every APF dropdown to these Hub SKUs — never fictional{" "}
              <code className="text-slate-400">FAB-SUN-5453-CAN</code> /{" "}
              <code className="text-slate-400">PWD-BLK-MAT</code>.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Phase 1 catalog (read-only)
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Collection</th>
                  <th className="px-3 py-2.5 font-medium">Product &amp; Size</th>
                  <th className="px-3 py-2.5 font-medium">Woo SKU</th>
                  <th className="px-3 py-2.5 font-medium">Regular/Sale</th>
                  <th className="px-3 py-2.5 font-medium">Weight &amp; Ship</th>
                  <th className="px-3 py-2.5 font-medium">Options</th>
                  <th className="px-3 py-2.5 font-medium">Mia Approved</th>
                </tr>
              </thead>
              <tbody>
                {props.storefrontRows.map((row) => (
                  <tr
                    key={row.wooSku}
                    className="border-t border-white/5 text-slate-200"
                  >
                    <td className="px-3 py-2 align-top text-slate-400">{row.collection}</td>
                    <td className="px-3 py-2 align-top">{row.productName}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-amber-200/90">
                      {row.wooSku}
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      ${row.regularPrice}
                      {row.salePrice ? (
                        <span className="text-emerald-400"> / ${row.salePrice}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      {row.weightLb} lb · {row.shippingClass}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-500 max-w-[14rem] truncate">
                      {row.options || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={
                          row.miaApproved
                            ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                            : "rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-400"
                        }
                      >
                        {row.miaApproved ? "Approved" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
