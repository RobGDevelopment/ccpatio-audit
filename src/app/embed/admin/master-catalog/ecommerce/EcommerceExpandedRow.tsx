"use client";

import React from "react";
import type { EcommerceListing } from "../actions";
import { SafeHtml } from "./SafeHtml";
import type {
  FactoryReadiness,
  FactoryState,
} from "@/server/factory-bom/derive-readiness";

const STATE_LABEL: Record<FactoryState, string> = {
  published: "Published",
  factory_approved: "Factory approved",
  draft_pending: "Draft pending",
  missing_cad: "Missing CAD",
};

const STATE_STYLE: Record<FactoryState, string> = {
  published: "bg-emerald-100 text-emerald-700",
  factory_approved: "bg-sky-100 text-sky-700",
  draft_pending: "bg-amber-100 text-amber-700",
  missing_cad: "bg-rose-100 text-rose-700",
};

/** Readiness badge (+ optional sublabel) used by the grid column and the Factory region. */
export function FactoryBadge({ factory }: { factory: FactoryReadiness }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${STATE_STYLE[factory.state]}`}
      >
        {STATE_LABEL[factory.state]}
      </span>
      {factory.sublabel && (
        <span className="text-[10px] text-slate-400">{factory.sublabel}</span>
      )}
    </span>
  );
}

const TITLE =
  "text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2";
const BODY = "text-sm leading-7 text-slate-700";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700">{value}</dd>
    </div>
  );
}

/** Full-width detail row: Marketing, Construction, Pricing, Factory. */
export default function EcommerceExpandedRow({
  listing,
  colSpan,
}: {
  listing: EcommerceListing;
  colSpan: number;
}) {
  const f = listing.factory;
  const dash = <span className="text-slate-400">—</span>;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-4 pt-0">
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-5 flex flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-[2fr_2fr_1fr]">
            <section>
              <h4 className={TITLE}>Marketing</h4>
              <SafeHtml
                html={listing.marketingDescription}
                className={BODY}
                empty={<p className={BODY}><span className="text-slate-400">No description on file.</span></p>}
              />
            </section>
            <section>
              <h4 className={TITLE}>Construction</h4>
              <SafeHtml
                html={listing.constructionDetails}
                className={BODY}
                empty={<p className={BODY}><span className="text-slate-400">No details on file.</span></p>}
              />
            </section>
            <section>
              <h4 className={TITLE}>Pricing</h4>
              <p className="text-lg font-semibold text-slate-800">
                {listing.aluminumMsrp ?? dash}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Aluminum frame MSRP</p>
              <p className="text-xs text-slate-400">Steel: {listing.msrp}</p>
            </section>
          </div>

          <section className="border-t border-slate-200/70 pt-4">
            <h4 className={TITLE}>Factory</h4>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
              <FactoryBadge factory={f} />
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                <Fact label="CAD file" value={f.cadFilename ?? dash} />
                <Fact label="CAD status" value={f.cadStatus ?? dash} />
                <Fact
                  label="Draft recipe"
                  value={f.draftRollup === "none" ? dash : f.draftRollup}
                />
                <Fact label="Live recipe" value={f.liveRecipe ? "Yes" : "No"} />
                <Fact label="Katana" value={f.katanaStatus ?? dash} />
                <Fact label="Recipe published" value={f.recipePublished ? "Yes" : "No"} />
              </dl>
              <a
                href={`/embed/factory-bom?sku=${encodeURIComponent(listing.globalSku)}`}
                className="ml-auto text-xs font-semibold text-sky-700 hover:underline whitespace-nowrap"
              >
                Open in Factory BOM →
              </a>
            </div>
            {listing.canonicalSkuShared && (
              <p className="mt-3 text-xs text-slate-400">
                Every listing on hub SKU {listing.globalSku} shares this recipe.
              </p>
            )}
          </section>
        </div>
      </td>
    </tr>
  );
}
