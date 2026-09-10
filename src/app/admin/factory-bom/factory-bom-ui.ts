import type { RecipeReviewStatus } from "@/server/db/schema";

export const PIM_INPUT =
  "pim-input w-full py-2 text-sm placeholder:text-zinc-600";

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

export function statusLabel(status: RecipeReviewStatus | "none"): string {
  if (status === "draft_pending_review") return "Auto-generated";
  if (status === "edited") return "Edited";
  if (status === "factory_approved") return "Factory approved";
  return "No draft";
}

export function statusClass(status: RecipeReviewStatus | "none"): string {
  if (status === "factory_approved") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "edited") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (status === "draft_pending_review") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

export function assemblyBadge(sku: string, itemType: string): string {
  if (itemType === "finished_good") return "FG";
  if (sku.endsWith("-CUSH")) return "CUSH";
  if (sku.endsWith("-FRAME")) return "FRAME";
  return "SA";
}
