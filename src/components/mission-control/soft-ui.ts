/**
 * Soft UI tokens for Mission Control: a light canvas, white floating cards with a diffuse shadow,
 * and gold accents. Cards that host a <GoldBeam /> must stay `relative overflow-hidden`.
 */
export const canvas = "min-h-screen bg-[#FAFAFA] text-slate-900";

export const card =
  "relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]";

export const innerCard =
  "rounded-xl bg-slate-50/80 p-4 ring-1 ring-slate-100";

export const eyebrow = "text-xs font-medium uppercase tracking-widest text-slate-500";

export const heading = "text-lg font-semibold tracking-tight text-slate-900";

export const muted = "text-sm text-slate-500";

export const field =
  "block w-full rounded-xl border-0 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-[#C5A059]";

export const btnPrimary =
  "rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-200 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

export const btnQuiet =
  "text-xs font-medium text-slate-500 transition hover:text-slate-900 disabled:opacity-50";

export const noticeError =
  "rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100";

export const noticeSuccess =
  "rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100";

export const badge =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1";
