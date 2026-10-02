/**
 * Parametric Level 2 BOMs for live SA-/ASM- frames.
 * Pure — no DB / no API. Callers supply live SKUs from GET /variants.
 *
 * Binding: Owner lock 2026-09-15 (club-chair / coffee-table North Stars).
 * Scrap 1.08 is already in the recipe qty (Katana consumes ft/lb/ea).
 */

export const LEVEL2_SCRAP = 1.08;
export const POWDER_LB_PER_TUBE_FT = 0.08;
export const SEATING_LEG_LENGTH_IN = 8;
export const CENTER_SUPPORT_MIN_WIDTH_IN = 72;
export const DEFAULT_SEATING_DEPTH_IN = 34;
export const OCEAN_SEATING_DEPTH_IN = 38;
export const CLUB_CHAIR_WIDTH_IN = 34;
export const TABLE_COFFEE_HEIGHT_IN = 16;
export const TABLE_DINING_HEIGHT_IN = 30;

export const RM_MET_2X2 = "RM-MET-2X2-TUBING";
export const RM_MET_15X075 = "RM-MET-15X075-TUBING";
export const RM_MET_FLATBAR = "RM-MET-FLATBAR";
/** Owner-requested powder SKU. Mapped to a live alias when absent. */
export const RM_POWDER_COAT = "RM-POWDER-COAT";
/** Owner-requested cap SKU. Mapped to a live alias when absent. */
export const RM_PLASTIC_CAP_2X2 = "RM-PLASTIC-CAP-2X2";

export const POWDER_LIVE_FALLBACKS = [
  "RM-PWD-GENERIC",
  "PWD-BLACK",
] as const;
export const CAP_LIVE_FALLBACKS = [
  "RM-HRD-2X2-METAL-CAP",
  "RM-HRD-2X2-CAP",
] as const;

const HAND_TOKENS = new Set(["LS", "RS", "LAF", "RAF"]);
const TABLE_TOKENS = new Set([
  "TAB",
  "TABLE",
  "CFT",
  "CT",
  "ST",
  "RST",
  "BASE",
  "TBLEND",
  "COF",
  "DIN",
  "BAR",
]);
const DINING_HEIGHT_TOKENS = new Set(["DIN", "BAR", "WFT", "CNT", "FIR"]);
const SKIP_TOKENS = new Set([
  "CUSH",
  "CUSHION",
  "PACK",
  "UMB",
  "UMBRELLA",
  "COVER",
  "SHADE",
  "RISER",
  "WEIGHT",
]);
const NESTED_WELDMENT_TOKENS = new Set(["SEAT", "BACK", "ARM"]);
const WXD = /^(\d{2,3})X(\d{2,3})$/;
const ONE_DIM = /^(\d{2,3})$/;
const CONCAT_DIM = /^(\d{2})(\d{2})$/;
const ROLE_SUFFIXES = new Set(["FRAME", "BASE"]);

export type Level2Family = "seating" | "table" | "skip";

export type ParsedSaFrame = {
  sku: string;
  family: Level2Family;
  skipReason: string | null;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  armCount: number;
  legCount: number;
  dimSource: string;
};

export type Level2BomLine = {
  parentSku: string;
  childSku: string;
  quantity: number;
  role: "2x2" | "slat" | "flatbar" | "powder" | "cap";
};

export type Level2Plan = {
  parsed: ParsedSaFrame;
  lines: Level2BomLine[];
  powderSku: string;
  capSku: string;
  tubingFeet: number;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function tokensOf(sku: string): string[] {
  return normalizeSku(sku).split("-").filter(Boolean);
}

function hasToken(tokens: readonly string[], token: string): boolean {
  return tokens.includes(token);
}

/**
 * Arm count from SKU grammar (Owner lock):
 *   ARMLESS or -ARM- → 0
 *   -LS- / -RS- / -LAF- / -RAF- → 1
 *   else → 2
 * Also honors Hub no-arm token `A` and `NOARM`.
 */
export function armCountFromSku(sku: string): number {
  const n = normalizeSku(sku);
  if (n.includes("ARMLESS") || n.includes("NOARM") || n.includes("-ARM-")) {
    return 0;
  }
  const tokens = tokensOf(n).filter((t) => !ROLE_SUFFIXES.has(t));
  if (tokens.includes("A") || tokens.includes("NOARM")) return 0;
  if (tokens.some((t) => HAND_TOKENS.has(t))) return 1;
  return 2;
}

/** Default 4 legs; W >= 72 adds two center supports. */
export function legCountFromWidth(widthIn: number): number {
  return widthIn >= CENTER_SUPPORT_MIN_WIDTH_IN ? 6 : 4;
}

export function isSaOrAsmSku(sku: string): boolean {
  const n = normalizeSku(sku);
  return n.startsWith("SA-") || n.startsWith("ASM-");
}

export function isLevel2FrameCandidate(sku: string): boolean {
  const n = normalizeSku(sku);
  if (!isSaOrAsmSku(n)) return false;
  return n.endsWith("-FRAME") || n.endsWith("-BASE");
}

function collectionToken(tokens: readonly string[]): string {
  if (tokens[0] === "SA" || tokens[0] === "ASM") return tokens[1] ?? "";
  return tokens[0] ?? "";
}

function defaultSeatingDepth(collection: string): number {
  if (collection === "OCE" || collection === "OCN") return OCEAN_SEATING_DEPTH_IN;
  return DEFAULT_SEATING_DEPTH_IN;
}

function looksLikeTable(tokens: readonly string[]): boolean {
  return tokens.some((t) => TABLE_TOKENS.has(t));
}

export function tableHeightIn(tokens: readonly string[]): number {
  if (tokens.some((t) => DINING_HEIGHT_TOKENS.has(t))) {
    return TABLE_DINING_HEIGHT_IN;
  }
  return TABLE_COFFEE_HEIGHT_IN;
}

function parseDims(
  tokens: readonly string[],
  collection: string,
): { widthIn: number; depthIn: number; source: string } | null {
  for (const token of tokens) {
    const wxd = WXD.exec(token);
    if (wxd) {
      return {
        widthIn: Number(wxd[1]),
        depthIn: Number(wxd[2]),
        source: token,
      };
    }
  }

  const isClub =
    hasToken(tokens, "CC") ||
    hasToken(tokens, "CLB") ||
    (hasToken(tokens, "CLB") && hasToken(tokens, "CHA"));

  for (const token of tokens) {
    if (HAND_TOKENS.has(token) || ROLE_SUFFIXES.has(token)) continue;
    if (SKIP_TOKENS.has(token) || NESTED_WELDMENT_TOKENS.has(token)) continue;
    const one = ONE_DIM.exec(token);
    if (one) {
      const w = Number(one[1]);
      if (w < 16 || w > 160) continue;
      const depth = isClub ? CLUB_CHAIR_WIDTH_IN : defaultSeatingDepth(collection);
      return { widthIn: w, depthIn: depth, source: `${token} (+default D=${depth})` };
    }
    const concat = CONCAT_DIM.exec(token);
    if (concat && token.length === 4) {
      const w = Number(concat[1]);
      const d = Number(concat[2]);
      if (w >= 20 && d >= 20 && w <= 99 && d <= 99) {
        return { widthIn: w, depthIn: d, source: `${token} (concat)` };
      }
    }
  }

  if (isClub) {
    const depth =
      collection === "OCE" || collection === "OCN"
        ? OCEAN_SEATING_DEPTH_IN
        : CLUB_CHAIR_WIDTH_IN;
    return {
      widthIn: CLUB_CHAIR_WIDTH_IN,
      depthIn: depth,
      source: `club-chair default ${CLUB_CHAIR_WIDTH_IN}x${depth}`,
    };
  }

  return null;
}

export function parseSaFrame(skuRaw: string): ParsedSaFrame {
  const sku = normalizeSku(skuRaw);
  const empty = (reason: string): ParsedSaFrame => ({
    sku,
    family: "skip",
    skipReason: reason,
    widthIn: 0,
    depthIn: 0,
    heightIn: 0,
    armCount: 0,
    legCount: 0,
    dimSource: "",
  });

  if (!isSaOrAsmSku(sku)) return empty("not SA-/ASM-");
  if (!isLevel2FrameCandidate(sku)) {
    return empty("not a FRAME/BASE parent");
  }

  const tokens = tokensOf(sku);
  if (tokens.some((t) => SKIP_TOKENS.has(t))) {
    return empty("cushion/accessory — skip metal BOM");
  }

  const core = tokens.filter((t) => !ROLE_SUFFIXES.has(t));
  const lastCore = core[core.length - 1];
  if (lastCore && NESTED_WELDMENT_TOKENS.has(lastCore)) {
    return empty("nested weldment (seat/back/arm) — skip");
  }

  const collection = collectionToken(tokens);
  const family: Exclude<Level2Family, "skip"> = looksLikeTable(tokens)
    ? "table"
    : "seating";
  const dims = parseDims(core, collection);
  if (!dims || dims.widthIn < 8 || dims.depthIn < 8) {
    return empty("could not parse WxD from SKU");
  }

  if (family === "table") {
    return {
      sku,
      family,
      skipReason: null,
      widthIn: dims.widthIn,
      depthIn: dims.depthIn,
      heightIn: tableHeightIn(tokens),
      armCount: 0,
      legCount: 4,
      dimSource: dims.source,
    };
  }

  const armCount = armCountFromSku(sku);
  const legCount = legCountFromWidth(dims.widthIn);
  return {
    sku,
    family,
    skipReason: null,
    widthIn: dims.widthIn,
    depthIn: dims.depthIn,
    heightIn: 0,
    armCount,
    legCount,
    dimSource: dims.source,
  };
}

/** Seating RM-MET-2X2-TUBING feet (includes 1.08 scrap). */
export function seatingTube2x2Feet(
  widthIn: number,
  depthIn: number,
  armCount: number,
  legCount: number,
): number {
  const inches =
    2 * widthIn +
    2 * depthIn +
    legCount * SEATING_LEG_LENGTH_IN +
    armCount * (depthIn - 2) +
    armCount * 14 +
    2 * 19 +
    2 * (widthIn - 4);
  return round4((inches / 12) * LEVEL2_SCRAP);
}

/** Seating RM-MET-15X075-TUBING feet (includes 1.08 scrap). */
export function seatingSlatFeet(widthIn: number, depthIn: number): number {
  const qty = Math.max(4, Math.round((4 * widthIn) / 34));
  return round4((qty * (depthIn - 4) / 12) * LEVEL2_SCRAP);
}

/** Seating RM-MET-FLATBAR feet (includes 1.08 scrap). */
export function seatingFlatbarFeet(widthIn: number): number {
  return round4(((2 * (widthIn - 4)) / 12) * LEVEL2_SCRAP);
}

/**
 * Table 2x2 from coffee-table North Star:
 *   4 end-frame rails of W + 4 legs of (H-1) + 4 stretchers of (D-4)
 */
export function tableTube2x2Feet(
  widthIn: number,
  depthIn: number,
  heightIn: number,
): number {
  const h = heightIn > 0 ? heightIn : TABLE_COFFEE_HEIGHT_IN;
  const inches = 4 * widthIn + 4 * (h - 1) + 4 * (depthIn - 4);
  return round4((inches / 12) * LEVEL2_SCRAP);
}

export function powderPoundsFromTubingFeet(tubingFeet: number): number {
  return round4(POWDER_LB_PER_TUBE_FT * tubingFeet);
}

export function resolveLiveIngredient(
  preferred: string,
  fallbacks: readonly string[],
  liveSkus: ReadonlySet<string>,
): { sku: string; live: boolean; aliasedFrom: string | null } {
  const want = normalizeSku(preferred);
  if (liveSkus.size === 0) {
    return { sku: want, live: false, aliasedFrom: null };
  }
  if (liveSkus.has(want)) {
    return { sku: want, live: true, aliasedFrom: null };
  }
  for (const fb of fallbacks) {
    const n = normalizeSku(fb);
    if (liveSkus.has(n)) {
      return { sku: n, live: true, aliasedFrom: want };
    }
  }
  return { sku: want, live: false, aliasedFrom: null };
}

export function buildLevel2Plan(
  skuRaw: string,
  liveSkus: ReadonlySet<string> = new Set(),
): Level2Plan {
  const parsed = parseSaFrame(skuRaw);
  const powder = resolveLiveIngredient(
    RM_POWDER_COAT,
    POWDER_LIVE_FALLBACKS,
    liveSkus,
  );
  const cap = resolveLiveIngredient(
    RM_PLASTIC_CAP_2X2,
    CAP_LIVE_FALLBACKS,
    liveSkus,
  );

  if (parsed.family === "skip" || parsed.skipReason) {
    return {
      parsed,
      lines: [],
      powderSku: powder.sku,
      capSku: cap.sku,
      tubingFeet: 0,
    };
  }

  const lines: Level2BomLine[] = [];
  let tube2x2 = 0;
  let slat = 0;

  if (parsed.family === "table") {
    tube2x2 = tableTube2x2Feet(
      parsed.widthIn,
      parsed.depthIn,
      parsed.heightIn,
    );
    lines.push({
      parentSku: parsed.sku,
      childSku: RM_MET_2X2,
      quantity: tube2x2,
      role: "2x2",
    });
  } else {
    tube2x2 = seatingTube2x2Feet(
      parsed.widthIn,
      parsed.depthIn,
      parsed.armCount,
      parsed.legCount,
    );
    slat = seatingSlatFeet(parsed.widthIn, parsed.depthIn);
    const flat = seatingFlatbarFeet(parsed.widthIn);
    lines.push(
      {
        parentSku: parsed.sku,
        childSku: RM_MET_2X2,
        quantity: tube2x2,
        role: "2x2",
      },
      {
        parentSku: parsed.sku,
        childSku: RM_MET_15X075,
        quantity: slat,
        role: "slat",
      },
      {
        parentSku: parsed.sku,
        childSku: RM_MET_FLATBAR,
        quantity: flat,
        role: "flatbar",
      },
    );
  }

  const tubingFeet = round4(tube2x2 + slat);
  const powderLb = powderPoundsFromTubingFeet(tubingFeet);
  if (powderLb > 0) {
    lines.push({
      parentSku: parsed.sku,
      childSku: powder.sku,
      quantity: powderLb,
      role: "powder",
    });
  }
  if (parsed.legCount > 0) {
    lines.push({
      parentSku: parsed.sku,
      childSku: cap.sku,
      quantity: parsed.legCount,
      role: "cap",
    });
  }

  return {
    parsed,
    lines: lines.filter((l) => l.quantity > 0),
    powderSku: powder.sku,
    capSku: cap.sku,
    tubingFeet,
  };
}
