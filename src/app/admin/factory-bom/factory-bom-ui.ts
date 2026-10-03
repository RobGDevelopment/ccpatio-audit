import type { RecipeReviewStatus } from "@/server/db/schema";

export const canvas = "min-h-screen bg-slate-50 text-slate-800";

export const card =
  "bg-white rounded-xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]";

export const softField =
  "w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-slate-400";

/** Light field used across Factory BOM. Replaces the shared dark `.pim-input`. */
export const PIM_INPUT = softField;

export const tactileIdle =
  "border-b-2 border-slate-200 bg-white text-slate-600 shadow-sm transition-all duration-150 ease-out";

export const tactilePressed =
  "translate-y-[2px] border-b-0 bg-slate-50 text-slate-800 shadow-inner";

export const tactileButton = `${tactileIdle} rounded-lg hover:translate-y-[2px] hover:border-b-0 hover:bg-slate-50 hover:text-slate-800 hover:shadow-inner active:translate-y-[2px] active:border-b-0 active:shadow-inner`;

export const primaryButton =
  "rounded-lg border-b-2 border-slate-950 bg-slate-800 text-white shadow-sm transition-all duration-150 ease-out hover:translate-y-[2px] hover:border-b-0 hover:shadow-inner active:translate-y-[2px] active:border-b-0 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-40";

export const pill =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide";

export const UNIT_OPTIONS = [
  "ea",
  "ft",
  "yd",
  "lb",
  "lbs",
  "boardft",
  "slab",
  "sqft",
  "in",
] as const;

export const PROFILE_OPTIONS = [
  "SQ2-16",
  "RT1.5x0.75-16",
  "FB0.125x1.5",
  "SQ2x1-16",
  "UNKNOWN",
] as const;

export const CONVENTION_OPTIONS = [
  { value: "long_point", label: "LP" },
  { value: "short_point", label: "SP" },
  { value: "square", label: "SQ" },
  { value: "unknown", label: "?" },
] as const;

/** Open-recipe badge. A draft line wins over an approved sibling. */
export function rollupReviewStatus(
  statuses: readonly RecipeReviewStatus[],
): RecipeReviewStatus | "none" {
  if (statuses.length === 0) return "none";
  if (statuses.some((status) => status === "edited")) return "edited";
  if (statuses.some((status) => status === "draft_pending_review")) {
    return "draft_pending_review";
  }
  if (statuses.every((status) => status === "factory_approved")) {
    return "factory_approved";
  }
  return statuses[0] ?? "none";
}

export function statusLabel(status: RecipeReviewStatus | "none"): string {
  if (status === "draft_pending_review") return "Auto-generated";
  if (status === "edited") return "Edited";
  if (status === "factory_approved") return "Factory approved";
  return "No draft";
}

export function statusClass(status: RecipeReviewStatus | "none"): string {
  if (status === "factory_approved") {
    return `${pill} bg-emerald-50 text-emerald-700`;
  }
  if (status === "edited") {
    return `${pill} bg-amber-50 text-amber-700`;
  }
  if (status === "draft_pending_review") {
    return `${pill} bg-sky-50 text-sky-700`;
  }
  return `${pill} bg-slate-100 text-slate-500`;
}

export function assemblyBadge(sku: string, itemType: string): string {
  if (itemType === "finished_good") return "FG";
  if (sku.endsWith("-CUSH")) return "CUSH";
  if (sku.endsWith("-FRAME")) return "FRAME";
  return "SA";
}
