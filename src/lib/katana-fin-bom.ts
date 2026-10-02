/**
 * Mint FIN-* → ASM-/SA-* multi-level recipe edges from live Katana SKUs.
 * Pure — no DB / no API. Callers supply the live SKU set from GET /variants.
 *
 * Canonical: FIN-BRV-SOF-72X34 → ASM-BRV-SOF-72X34-FRAME (+ CUSH / DKT when live).
 * Colorway FINs share unsuffixed twins after the WxD token.
 *
 * Legacy drift (Owner lock): Hub FIN-BRK-CHS-72X34-LS-BE → Katana
 * SA-BRO-C-72X34-LS-FRAME. Alias dictionary below; pickLive still prefers
 * a live ASM-* twin when one exists.
 */

export type FinRecipeIngredient = {
  productSku: string;
  ingredientSku: string;
  quantity: number;
  role: "FRAME" | "CUSH" | "DKT";
};

const COLOR_TOKENS = new Set([
  "BE",
  "BO",
  "BR",
  "GR",
  "WH",
  "BL",
  "WT",
  "Y",
  "N",
  "YES",
  "NO",
]);

const HAND_TOKENS = new Set(["LS", "RS", "LAF", "RAF"]);

/** LAF/RAF are factory synonyms for LS/RS on some Katana frames. */
const HAND_SEARCH: Record<string, readonly string[]> = {
  LS: ["LS", "LAF"],
  RS: ["RS", "RAF"],
  LAF: ["LAF", "LS"],
  RAF: ["RAF", "RS"],
};

const DIM_TOKEN = /^(\d{2,3})(?:X(\d{2,3}))?$/;

/** Hub collection token → legacy Katana SA collection code. */
const COLLECTION_ALIAS: Readonly<Record<string, string>> = {
  BRK: "BRO",
  BRV: "BRA",
  OCN: "OCE",
};

type DimMode = "full" | "first" | "concat" | "none";

type CatAlias = {
  fin: string;
  sa: string;
  dim: DimMode;
};

/**
 * Hub category code → legacy Katana model letters.
 * Most-specific first (TRA-DOU-CHS before DOU-CHS before CHS).
 */
const CATEGORY_ALIASES: readonly CatAlias[] = [
  { fin: "TRA-DOU-CHS", sa: "TC-D", dim: "none" },
  { fin: "TRA-SGL-CHS", sa: "TC-S", dim: "none" },
  { fin: "OTT-DKT", sa: "ODT", dim: "full" },
  { fin: "COR-SOF", sa: "CS", dim: "first" },
  { fin: "COR-CHS", sa: "C", dim: "full" },
  { fin: "ARM-SOF", sa: "AS", dim: "first" },
  { fin: "ARM-LOV", sa: "AL", dim: "first" },
  { fin: "COF-TAB", sa: "CT", dim: "full" },
  { fin: "SID-TAB", sa: "ST", dim: "full" },
  { fin: "CLB-CHA", sa: "CC", dim: "none" },
  { fin: "SWV-CHA", sa: "SC", dim: "none" },
  { fin: "MIN-LOV", sa: "ML", dim: "none" },
  { fin: "LOV-SOF", sa: "L", dim: "none" },
  { fin: "DOU-CHS", sa: "CL-D", dim: "none" },
  { fin: "SGL-CHS", sa: "CL-S", dim: "none" },
  { fin: "CHS", sa: "C", dim: "full" },
  { fin: "SOF", sa: "S", dim: "first" },
  { fin: "OTT", sa: "O", dim: "full" },
  { fin: "DYB", sa: "CADA", dim: "full" },
];

/** Extra legacy codes tried after the primary alias. */
const CATEGORY_ALIAS_EXTRAS: Readonly<Record<string, readonly string[]>> = {
  "DOU-CHS": ["DCL"],
  "SGL-CHS": ["SCL"],
  DYB: ["D"],
  "SID-TAB": ["RST"],
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Strip colorway / option tokens after the model dimension (34X34, 72X28, 120X36).
 * FIN-BRV-CLB-CHA-34X34-LS-BE → FIN-BRV-CLB-CHA-34X34
 * SKUs with no WxD token are returned unchanged.
 */
export function getBaseSku(sku: string): string {
  const n = normalizeSku(sku);
  const match = n.match(/^(.*?-\d{2,3}X\d{2,3})(?:-|$)/);
  return match?.[1] ?? n;
}

function finStem(finSku: string): string {
  return getBaseSku(finSku).replace(/^FIN-/, "");
}

export type FinTwinParts = {
  collection: string;
  category: string;
  dimToken: string | null;
  hand: string | null;
  noArm: boolean;
};

/**
 * Split a FIN SKU into collection / category / WxD / handedness / color.
 * Colors and Ocean Y/N flags are dropped; LS|RS|LAF|RAF are kept.
 */
export function parseFinTwinParts(finSku: string): FinTwinParts | null {
  const n = normalizeSku(finSku);
  if (!n.startsWith("FIN-")) return null;
  const parts = n.split("-").filter(Boolean).slice(1);
  if (parts.length < 2) return null;

  let noArm = false;
  while (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    if (last === "NOARM") {
      parts.pop();
      noArm = true;
      continue;
    }
    if (COLOR_TOKENS.has(last)) {
      parts.pop();
      continue;
    }
    break;
  }

  let hand: string | null = null;
  const maybeHand = parts[parts.length - 1];
  if (maybeHand && HAND_TOKENS.has(maybeHand)) {
    hand = parts.pop()!;
  }

  const collection = parts.shift();
  if (!collection) return null;

  let dimToken: string | null = null;
  const maybeDim = parts[parts.length - 1];
  if (maybeDim && DIM_TOKEN.test(maybeDim)) {
    dimToken = parts.pop()!;
  }

  const category = parts.join("-");
  if (!category) {
    return { collection, category: "", dimToken, hand, noArm };
  }
  return { collection, category, dimToken, hand, noArm };
}

function formatDim(alias: CatAlias, dimToken: string | null): string[] {
  if (alias.dim === "none" || !dimToken) return [""];
  const m = DIM_TOKEN.exec(dimToken);
  if (!m) return [dimToken];
  const a = m[1]!;
  const b = m[2];
  if (alias.dim === "first") return [a];
  if (alias.dim === "concat") {
    return b ? [`${a}${b}`] : [a];
  }
  // full WxD — also try swapped order (Katana vs Hub disagree on LxD).
  if (!b) return [a];
  const full = `${a}X${b}`;
  const swapped = `${b}X${a}`;
  return full === swapped ? [full] : [full, swapped];
}

function matchCategoryAlias(category: string): CatAlias | null {
  for (const alias of CATEGORY_ALIASES) {
    if (category === alias.fin) return alias;
  }
  return null;
}

function handVariants(hand: string | null): Array<string | null> {
  if (!hand) return [null];
  const mapped = HAND_SEARCH[hand] ?? [hand];
  return [...mapped];
}

/**
 * Legacy SA-* FRAME/CUSH stems for Hub FINs that do not share ASM grammar.
 * Example: FIN-BRK-CHS-72X34-LS-BE → SA-BRO-C-72X34-LS-FRAME
 */
export function legacySaTwinStems(finSku: string): string[] {
  const parsed = parseFinTwinParts(finSku);
  if (!parsed) return [];
  const legacyCol = COLLECTION_ALIAS[parsed.collection];
  if (!legacyCol) return [];
  const primary = matchCategoryAlias(parsed.category);
  if (!primary) return [];

  const saCodes = [
    primary.sa,
    ...(CATEGORY_ALIAS_EXTRAS[parsed.category] ?? []),
  ];
  // Daybed concat form BRA-D-7272 uses extras "D" with concat dims.
  const stems: string[] = [];
  const seen = new Set<string>();

  const push = (stem: string) => {
    if (!stem || seen.has(stem)) return;
    seen.add(stem);
    stems.push(stem);
  };

  for (const saCode of saCodes) {
    const dimMode: DimMode =
      saCode === "D" && parsed.category === "DYB" ? "concat" : primary.dim;
    const alias: CatAlias = { fin: parsed.category, sa: saCode, dim: dimMode };
    const dims = formatDim(alias, parsed.dimToken);
    for (const dim of dims) {
      for (const hand of handVariants(parsed.hand)) {
        const bits = [legacyCol, saCode];
        if (dim) bits.push(dim);
        if (hand && alias.dim !== "none") bits.push(hand);
        if (parsed.noArm) bits.push("A");
        push(bits.join("-"));
      }
      if (parsed.hand && alias.dim !== "none") {
        const bits = [legacyCol, saCode];
        if (dim) bits.push(dim);
        if (parsed.noArm) bits.push("A");
        push(bits.join("-"));
      }
    }
  }

  return stems;
}

function withRoles(stems: readonly string[], role: "FRAME" | "CUSH" | "DKT"): string[] {
  const out: string[] = [];
  for (const stem of stems) {
    if (role === "FRAME") {
      out.push(`ASM-${stem}-FRAME`, `SA-${stem}-FRAME`);
    } else if (role === "CUSH") {
      out.push(
        `ASM-${stem}-CUSH`,
        `ASM-${stem}-CUSHION`,
        `SA-${stem}-CUSH`,
        `SA-${stem}-CUSHION`,
      );
    } else {
      out.push(
        `ASM-${stem}-DKT`,
        `ASM-${stem}-DKT-TOP`,
        `SA-${stem}-DKT`,
        `SA-${stem}-DKT-TOP`,
      );
    }
  }
  return out;
}

function canonicalStems(finSku: string): string[] {
  const parsed = parseFinTwinParts(finSku);
  const base = finStem(finSku);
  const stems = [base];
  if (parsed?.hand) {
    const withHand = `${base}-${parsed.hand}`;
    if (withHand !== base) stems.unshift(withHand);
  }
  return stems;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const n = normalizeSku(v);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function frameCandidates(finSku: string): string[] {
  const canonical = withRoles(canonicalStems(finSku), "FRAME");
  const legacy = legacySaTwinStems(finSku).flatMap((stem) => [
    `SA-${stem}-FRAME`,
    `ASM-${stem}-FRAME`,
  ]);
  return unique([...canonical, ...legacy]);
}

export function cushCandidates(finSku: string): string[] {
  const canonical = withRoles(canonicalStems(finSku), "CUSH");
  const legacy = legacySaTwinStems(finSku).flatMap((stem) => [
    `SA-${stem}-CUSH`,
    `SA-${stem}-CUSHION`,
    `ASM-${stem}-CUSH`,
    `ASM-${stem}-CUSHION`,
  ]);
  return unique([...canonical, ...legacy]);
}

export function dktCandidates(finSku: string): string[] {
  return unique(withRoles(canonicalStems(finSku), "DKT"));
}

/** Stem used to hunt twins (legacy SA stem when dictionary hits). */
export function getFinStem(finSku: string): string {
  const legacy = legacySaTwinStems(finSku)[0];
  if (legacy) return legacy;
  return finStem(finSku);
}

/** Primary FRAME SKU shown in unmatched logs / Owner cross-ref. */
export function searchedAsmFrameSku(finSku: string): string {
  const legacy = legacySaTwinStems(finSku)[0];
  if (legacy) return `SA-${legacy}-FRAME`;
  return `ASM-${finStem(finSku)}-FRAME`;
}

/** Prefer ASM-*, then legacy SA-* if that is what Katana still has. */
function pickLive(
  live: ReadonlySet<string>,
  candidates: readonly string[],
): string | null {
  for (const sku of candidates) {
    const n = normalizeSku(sku);
    if (live.has(n)) return n;
  }
  return null;
}

/**
 * Build FIN recipe rows for ingredients that exist in the live Katana SKU set.
 * Quantity is always 1 for each ASM/SA component.
 */
export function resolveFinMultiLevelIngredients(
  finSkuRaw: string,
  liveSkus: ReadonlySet<string>,
): FinRecipeIngredient[] {
  const finSku = normalizeSku(finSkuRaw);
  if (!finSku.startsWith("FIN-")) return [];
  if (!liveSkus.has(finSku)) return [];

  const out: FinRecipeIngredient[] = [];

  const frame = pickLive(liveSkus, frameCandidates(finSku));
  if (frame) {
    out.push({
      productSku: finSku,
      ingredientSku: frame,
      quantity: 1,
      role: "FRAME",
    });
  }

  const cush = pickLive(liveSkus, cushCandidates(finSku));
  if (cush) {
    out.push({
      productSku: finSku,
      ingredientSku: cush,
      quantity: 1,
      role: "CUSH",
    });
  }

  const dkt = pickLive(liveSkus, dktCandidates(finSku));
  if (dkt) {
    out.push({
      productSku: finSku,
      ingredientSku: dkt,
      quantity: 1,
      role: "DKT",
    });
  }

  return out;
}
