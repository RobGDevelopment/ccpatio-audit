/**
 * Pure helpers for GHL E-Commerce Portal storefront readiness —
 * title stripping, variation labels, surface/freight/media badges,
 * APF target groups, and staging-guard messaging.
 */

import { storefrontTitlePreserveAcronyms } from "@/server/ecommerce/executive-stack-health";
import { isFreestandingNonSectionalProduct } from "@/server/ecommerce/katana-ssot-bridge";

export type SurfaceProfile =
  | "Cushion + Frame"
  | "Cushion + Pillow + Frame"
  | "Dekton Tabletop + Frame"
  | "Umbrella Canopy + Frame"
  | "Finish / Hardware Only [Heaters, Lamps, Pool]"
  | "Frame Only";

export type SurfaceBadge =
  | "Cushion"
  | "Pillow"
  | "Tabletop"
  | "Umbrella"
  | "Hardware"
  | "Frame";

export type ApfTargetGroup = "Cushion & Pillow" | "Dekton Tabletop" | "Aluminum Frame";

export type FreightDimsBadge = "Ready" | "Missing Dims";

export type MediaBadge = "WP Gallery Preserved" | "Hub Media" | ".glb";

const FIN_BRACKET_RE = /\s*\[FIN-[^\]]*\]\s*/gi;

/** Strip raw `[FIN-…]` bracket suffixes from customer-facing titles. */
export function stripFinBracketsFromTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(FIN_BRACKET_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/** Title Case storefront display title with FIN brackets removed; preserve BH/SH/OD/LED. */
export function storefrontDisplayTitle(raw: string | null | undefined): string {
  const cleaned = stripFinBracketsFromTitle(raw);
  if (!cleaned) return "";
  return storefrontTitlePreserveAcronyms(cleaned);
}

/** Format Variations / Facing cell: Simple vs 2 Vars (-LS / -RS). */
export function formatVariationsFacing(input: {
  globalSku: string;
  wooSku?: string | null;
  variationCount?: number | null;
  hasLsRsPair?: boolean;
  productName?: string | null;
  collectionLabel?: string | null;
}): string {
  // Heaters / lamps / loungers are freestanding Simple — never sectional facing badges.
  if (
    isFreestandingNonSectionalProduct({
      productName: input.productName,
      globalSku: input.globalSku,
      wooSku: input.wooSku,
      collectionLabel: input.collectionLabel,
    })
  ) {
    return "Simple";
  }
  const sku = (input.wooSku || input.globalSku || "").toUpperCase();
  const isFacing = /-(LS|RS)$/i.test(sku);
  const pair = input.hasLsRsPair === true || isFacing || (input.variationCount ?? 0) >= 2;
  if (pair) return "2 Vars (-LS / -RS)";
  return "Simple";
}

export function apfTargetGroupForFamily(
  family: "sunbrella" | "ultraleather" | "dekton" | "powder",
): ApfTargetGroup {
  if (family === "dekton") return "Dekton Tabletop";
  if (family === "powder") return "Aluminum Frame";
  return "Cushion & Pillow";
}

export function surfaceBadgeFromProfile(profile: SurfaceProfile | null | undefined): SurfaceBadge {
  switch (profile) {
    case "Dekton Tabletop + Frame":
      return "Tabletop";
    case "Umbrella Canopy + Frame":
      return "Umbrella";
    case "Finish / Hardware Only [Heaters, Lamps, Pool]":
      return "Hardware";
    case "Frame Only":
      return "Frame";
    case "Cushion + Pillow + Frame":
      return "Pillow";
    case "Cushion + Frame":
    default:
      return "Cushion";
  }
}

/** Infer a default surface profile from product name / collection heuristics. */
export function inferSurfaceProfile(input: {
  productName?: string | null;
  collectionLabel?: string | null;
  attributes?: Record<string, unknown> | null;
}): SurfaceProfile {
  const attr = input.attributes ?? {};
  const stored = attr.surface_profile ?? attr.addon_profile ?? attr.customizable_surface;
  if (
    stored === "Cushion + Frame" ||
    stored === "Cushion + Pillow + Frame" ||
    stored === "Dekton Tabletop + Frame" ||
    stored === "Umbrella Canopy + Frame" ||
    stored === "Finish / Hardware Only [Heaters, Lamps, Pool]" ||
    stored === "Frame Only"
  ) {
    return stored;
  }
  const hay = `${input.productName ?? ""} ${input.collectionLabel ?? ""}`.toUpperCase();
  // Umbrellas (CANTILEVER UMBRELLA, etc.)
  if (/\bUMBRELLA\b|\bCANOPY\b/.test(hay)) return "Umbrella Canopy + Frame";
  // Heaters, Lamps & non-cushion pool (KINDLE LIVING HEATER/LAMP, TROPICS pool)
  if (
    /\bHEATER\b|\bLAMP\b|\bKINDLE LIVING\b|\bTROPICS\b/.test(hay) &&
    !/\bCUSHION\b|\bSOFA\b|\bSECTIONAL\b/.test(hay)
  ) {
    return "Finish / Hardware Only [Heaters, Lamps, Pool]";
  }
  if (/\bPOOL\b/.test(hay) && !/\bCUSHION\b|\bLOUNGE CHAIR\b|\bCHAISE\b/.test(hay)) {
    return "Finish / Hardware Only [Heaters, Lamps, Pool]";
  }
  // Dining / Coffee / Side / Chat / Bar Tables → Dekton Tabletop + Frame (never Cushion)
  if (
    /\bTABLE\b|\bTABLETOP\b|\bDEKTON\b/.test(hay) ||
    /\b(DINING|COFFEE|SIDE|CHAT|BAR)\b.*\bTAB/.test(hay) ||
    /\b(DIN|COF|SID|CHA|BAR)[- ].*TAB\b/.test(hay)
  ) {
    return "Dekton Tabletop + Frame";
  }
  if (/FRAME ONLY|POWDER/.test(hay) && !/CUSHION|PILLOW|SOFA|CHAIR/.test(hay)) {
    return "Frame Only";
  }
  if (/\bPILLOW\b/.test(hay)) return "Cushion + Pillow + Frame";
  return "Cushion + Frame";
}

export function freightDimsBadge(input: {
  weightLb?: number | string | null;
  lengthIn?: number | string | null;
  widthIn?: number | string | null;
  heightIn?: number | string | null;
}): FreightDimsBadge {
  const nums = [input.weightLb, input.lengthIn, input.widthIn, input.heightIn].map((v) => {
    if (v == null || v === "") return NaN;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  });
  return nums.every((n) => Number.isFinite(n)) ? "Ready" : "Missing Dims";
}

export function mediaBadge(input: {
  hasGlb?: boolean;
  hasHubMedia?: boolean;
  preserveWpGallery?: boolean;
}): MediaBadge {
  if (input.hasGlb) return ".glb";
  if (input.hasHubMedia) return "Hub Media";
  return "WP Gallery Preserved";
}

export function downstreamMutationsEnabled(): boolean {
  return (process.env.DOWNSTREAM_MUTATIONS ?? "false").trim().toLowerCase() === "true";
}

export function wooLedgerMode(): string {
  return (process.env.WOO_LEDGER_MODE ?? "log").trim().toLowerCase() || "log";
}

/**
 * Staging push guardrail copy — never flips env flags.
 * When DOWNSTREAM_MUTATIONS=false, callers must run a verified non-mutating simulation.
 */
export function stagingPushGuardrailMessage(): {
  liveWrite: boolean;
  mode: string;
  label: string;
} {
  const live = downstreamMutationsEnabled() && wooLedgerMode() === "live";
  return {
    liveWrite: live,
    mode: wooLedgerMode(),
    label: live
      ? "LIVE write enabled (DOWNSTREAM_MUTATIONS=true, WOO_LEDGER_MODE=live)"
      : "Verified non-mutating staging simulation (DOWNSTREAM_MUTATIONS=false or WOO_LEDGER_MODE≠live)",
  };
}

export const SURFACE_PROFILE_OPTIONS: readonly SurfaceProfile[] = [
  "Cushion + Frame",
  "Cushion + Pillow + Frame",
  "Dekton Tabletop + Frame",
  "Umbrella Canopy + Frame",
  "Finish / Hardware Only [Heaters, Lamps, Pool]",
  "Frame Only",
] as const;
