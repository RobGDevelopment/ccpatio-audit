"use client";

import React from "react";
import type { EcommerceListing } from "../actions";

/** Full-width detail row shown beneath an expanded listing. */
export default function EcommerceExpandedRow({
  listing,
  colSpan,
}: {
  listing: EcommerceListing;
  colSpan: number;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-4 pt-0">
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-5 grid gap-6 md:grid-cols-[2fr_2fr_1fr]">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Marketing Description
            </h4>
            <p className="text-sm leading-relaxed text-slate-700">
              {listing.marketingDescription ?? (
                <span className="text-slate-400">No description on file.</span>
              )}
            </p>
          </section>
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Construction Details
            </h4>
            <p className="text-sm leading-relaxed text-slate-700">
              {listing.constructionDetails ?? (
                <span className="text-slate-400">No details on file.</span>
              )}
            </p>
          </section>
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Aluminum Frame MSRP
            </h4>
            <p className="text-lg font-semibold text-slate-800">
              {listing.aluminumMsrp ?? <span className="text-slate-400">—</span>}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Steel: {listing.msrp}
            </p>
          </section>
        </div>
      </td>
    </tr>
  );
}
