/**
 * Monolithic-frame cutover: drop ARM/BACK/SEAT weldments, link FIN → one
 * dimensioned FRAME (+ CUSH), then parametric Level 2 metal on that FRAME.
 *
 * Phase 2 universal Level 1: every live FIN-* fans out to matching live
 * FRAME/CUSH (and Dekton on tables) via parseFinTwinParts identity.
 *
 * Pure — no DB / no API. Callers supply live SKUs + live BOM edges.
 */

import {
  cushCandidates,
  dktCandidates,
  frameCandidates,
  parseFinTwinParts,
  type FinTwinParts,
} from "@/lib/katana-fin-bom";
import { GENERIC_DEKTON_SKU } from "@/mappers/katana-catalog-guard";
import { buildLevel2Plan, type Level2BomLine } from "@/lib/level2-bom";

const WELDMENT_ROLES = new Set(["ARM", "BACK", "SEAT"]);
const KEEP_ROLES = new Set([
  "FRAME",
  "CUSH",
  "CUSHION",
  "BASE",
  "PACK",
  "DKT",
  "TOP",
]);
const DIMLESS_MODEL_CODES = new Set([
  "CC",
  "SC",
  "ML",
  "L",
  "DCL",
  "SCL",
  "TC-D",
  "TC-S",
]);
const WXD = /(\d{2,3})X(\d{2,3})/;
const ONE_DIM = /^(\d{2,3})$/;

export type RecipeEdge = {
  parentSku: string;
  ingredientSku: string;
  quantity?: number;
};

export type MonolithicLevel1Edge = {
  productSku: string;
  ingredientSku: string;
  quantity: number;
  role: "FRAME" | "CUSH" | "DKT";
  live: boolean;
};

export type FinBomFamily = "seating" | "table" | "skip";

const HAND_SEARCH: Record<string, readonly string[]> = {
  LS: ["LS", "LAF"],
  RS: ["RS", "RAF"],
  LAF: ["LAF", "LS"],
  RAF: ["RAF", "RS"],
};

/**
 * Seat-type tokens win over table tokens (Owner lock 2026-09-15).
 * `DIN` / `BAR` / `CNT` are height-and-room qualifiers, not the furniture type:
 * `DIN-TAB` is a table but `DIN-CHA` / `DIN-BCH` / `BEN-DIN-HEI` are seating and
 * must keep their cushion and never receive a stone top.
 */
const SEATING_CATEGORY_TOKENS = new Set([
  "CHA",
  "CHS",
  "SOF",
  "LOV",
  "OTT",
  "CLB",
  "SWV",
  "DYB",
  "BCH",
  "BEN",
  "BST",
  "STL",
  "SWG",
]);

const TABLE_CATEGORY_TOKENS = new Set([
  "TAB",
  "TABLE",
  "CFT",
  "CT",
  "ST",
  "RST",
  "TBLEND",
  "COF",
  "DIN",
  "CNT",
  "WFT",
  "FIR",
  "SID",
  "BAR",
]);

const SKIP_CATEGORY_TOKENS = new Set([
  "UMB",
  "UMBRELLA",
  "COVER",
  "SHADE",
  "WEIGHT",
  "RISER",
  "LAMP",
  "PILLOW",
]);


const COLLECTION_ALIASES: Readonly<Record<string, string>> = {
  BRK: "BRO",
  BRV: "BRA",
  OCN: "OCE",
  BRO: "BRK",
  BRA: "BRV",
  OCE: "OCN",
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function tokensOf(sku: string): string[] {
  return normalizeSku(sku).split("-").filter(Boolean);
}

export function hasDimensionToken(sku: string): boolean {
  const n = normalizeSku(sku);
  if (WXD.test(n)) return true;
  return tokensOf(n).some((t) => {
    const m = ONE_DIM.exec(t);
    if (!m) return false;
    const v = Number(m[1]);
    return v >= 16 && v <= 160;
  });
}

/**
 * Shared ARM / BACK / SEAT weldments (not ARM-SOF FRAME products).
 * Examples: SA-BRV-ARM, SA-BRV-CLB-CHA-34X34-BACK, SA-BRV-CLB-CHA-34X34-SEAT.
 */
export function isModularWeldmentSku(skuRaw: string): boolean {
  const sku = normalizeSku(skuRaw);
  if (!sku.startsWith("SA-") && !sku.startsWith("ASM-")) return false;
  const parts = tokensOf(sku);
  const last = parts[parts.length - 1];
  if (!last) return false;
  if (KEEP_ROLES.has(last)) return false;
  return WELDMENT_ROLES.has(last);
}

/** Collection-level FRAME/CUSH with no WxD (SA-BRA-CC-FRAME, SA-OCE-L-CUSH). */
export function isDimlessCollectionSa(skuRaw: string): boolean {
  const sku = normalizeSku(skuRaw);
  if (!sku.startsWith("SA-") && !sku.startsWith("ASM-")) return false;
  if (!sku.endsWith("-FRAME") && !sku.endsWith("-CUSH") && !sku.endsWith("-CUSHION")) {
    return false;
  }
  if (hasDimensionToken(sku)) return false;
  const core = tokensOf(sku).filter((t) => !KEEP_ROLES.has(t) && t !== "SA" && t !== "ASM");
  const model = core.slice(1).join("-");
  return DIMLESS_MODEL_CODES.has(model) || core.includes("CC") || core.includes("CLB");
}

export function isNonMonolithicIngredient(skuRaw: string): boolean {
  return isModularWeldmentSku(skuRaw) || isDimlessCollectionSa(skuRaw);
}

export function defaultClubChairDim(collection: string): string {
  const c = collection.trim().toUpperCase();
  if (c === "OCN" || c === "OCE") return "34X38";
  return "34X34";
}

function isClubChairCategory(category: string): boolean {
  const c = category.toUpperCase();
  return c === "CLB-CHA" || c === "CLB" || c === "CC";
}

function isSwivelCategory(category: string): boolean {
  const c = category.toUpperCase();
  return c === "SWV-CHA" || c === "SWV" || c === "SC";
}

/** Club chairs and swivels may omit WxD on the FIN; default 34X34 / Ocean 34X38. */
export function needsDefaultSeatDim(category: string): boolean {
  return isClubChairCategory(category) || isSwivelCategory(category);
}

export function isOceanCollection(collection: string): boolean {
  const c = collection.trim().toUpperCase();
  return c === "OCN" || c === "OCE";
}

/**
 * Ordered WxD guesses when the FIN has no (or incomplete) dimension token.
 * Ocean tries 34X38 then 34X34 so a live swivel at 34X34 still matches.
 */
export function defaultSeatDimTokens(collection: string, category: string): string[] {
  if (!needsDefaultSeatDim(category)) return [];
  if (isOceanCollection(collection)) return ["34X38", "34X34"];
  return ["34X34"];
}

function categoryTokens(category: string): string[] {
  return category
    .trim()
    .toUpperCase()
    .split("-")
    .filter(Boolean);
}

export function classifyFinFamily(parsed: FinTwinParts): FinBomFamily {
  const tokens = categoryTokens(parsed.category);
  if (tokens.some((t) => SKIP_CATEGORY_TOKENS.has(t))) return "skip";
  if (tokens.some((t) => SEATING_CATEGORY_TOKENS.has(t))) return "seating";
  if (tokens.some((t) => TABLE_CATEGORY_TOKENS.has(t))) return "table";
  return "seating";
}

/**
 * Every table carries a stone top; the Dekton ottoman is the one hybrid that
 * gets a slab on top of its frame and cushion.
 */
export function dektonApplicable(parsed: FinTwinParts): boolean {
  if (classifyFinFamily(parsed) === "table") return true;
  const tokens = categoryTokens(parsed.category);
  return tokens.includes("OTT") && tokens.includes("DKT");
}

function handVariants(hand: string | null): Array<string | null> {
  if (!hand) return [null];
  return [...(HAND_SEARCH[hand] ?? [hand])];
}

function collectionsEquivalent(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  if (left === right) return true;
  return COLLECTION_ALIASES[left] === right;
}

function buildStem(
  parsed: FinTwinParts,
  dim: string,
  hand: string | null,
): string {
  const bits = [parsed.collection, parsed.category, dim];
  if (hand) bits.push(hand);
  if (parsed.noArm) bits.push("NOARM");
  return bits.filter(Boolean).join("-");
}

function resolvedDimTokens(parsed: FinTwinParts): string[] {
  const raw = parsed.dimToken;
  const defaults = defaultSeatDimTokens(parsed.collection, parsed.category);
  if (!raw) return defaults;
  if (WXD.test(raw)) return [raw];
  if (ONE_DIM.test(raw) && needsDefaultSeatDim(parsed.category)) {
    return defaults.length > 0 ? defaults : [defaultClubChairDim(parsed.collection)];
  }
  return [raw];
}

/**
 * Ordered Hub-grammar stems from parseFinTwinParts.
 * Color / Ocean Y|N stripped; LS|RS|LAF|RAF kept; club/swivel dims defaulted.
 */
export function identityStemCandidates(finSkuRaw: string): string[] {
  const parsed = parseFinTwinParts(finSkuRaw);
  if (!parsed) return [];
  if (classifyFinFamily(parsed) === "skip") return [];
  const dims = resolvedDimTokens(parsed);
  if (dims.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dim of dims) {
    for (const hand of handVariants(parsed.hand)) {
      const stem = buildStem(parsed, dim, hand);
      if (!stem || seen.has(stem)) continue;
      seen.add(stem);
      out.push(stem);
    }
  }
  return out;
}

/**
 * Hub-grammar dimensioned stem: BRV-CLB-CHA-34X34 (not legacy BRA-CC).
 * Colorways stripped; LS/RS/LAF/RAF kept.
 */
export function monolithicStem(finSkuRaw: string): string | null {
  return identityStemCandidates(finSkuRaw)[0] ?? null;
}

export function canonicalMonolithicFrameSku(finSku: string): string | null {
  const stem = monolithicStem(finSku);
  return stem ? `SA-${stem}-FRAME` : null;
}

export function canonicalMonolithicCushSku(finSku: string): string | null {
  const stem = monolithicStem(finSku);
  return stem ? `SA-${stem}-CUSH` : null;
}

function pickLiveDimensioned(
  live: ReadonlySet<string>,
  candidates: readonly string[],
): string | null {
  for (const sku of candidates) {
    const n = normalizeSku(sku);
    if (!n || !hasDimensionToken(n)) continue;
    if (live.has(n)) return n;
  }
  return null;
}

export function resolveMonolithicLevel1(
  finSkuRaw: string,
  liveSkus: ReadonlySet<string>,
): MonolithicLevel1Edge[] {
  const finSku = normalizeSku(finSkuRaw);
  if (!finSku.startsWith("FIN-")) return [];
  const stem = monolithicStem(finSku);
  if (!stem) return [];

  const hubFrames = [`ASM-${stem}-FRAME`, `SA-${stem}-FRAME`];
  const hubCush = [
    `ASM-${stem}-CUSH`,
    `SA-${stem}-CUSH`,
    `ASM-${stem}-CUSHION`,
    `SA-${stem}-CUSHION`,
  ];

  const frameLive = pickLiveDimensioned(liveSkus, hubFrames);
  const cushLive = pickLiveDimensioned(liveSkus, hubCush);
  const frameSku = frameLive ?? canonicalMonolithicFrameSku(finSku);
  const cushSku = cushLive ?? canonicalMonolithicCushSku(finSku);
  if (!frameSku) return [];

  const out: MonolithicLevel1Edge[] = [
    {
      productSku: finSku,
      ingredientSku: frameSku,
      quantity: 1,
      role: "FRAME",
      live: liveSkus.has(frameSku),
    },
  ];
  if (cushSku) {
    out.push({
      productSku: finSku,
      ingredientSku: cushSku,
      quantity: 1,
      role: "CUSH",
      live: liveSkus.has(cushSku),
    });
  }
  return out;
}

type TwinRole = "FRAME" | "CUSH" | "DKT";

export type IndexedMonolithicTwin = {
  sku: string;
  role: TwinRole;
  parts: FinTwinParts;
  prefix: "ASM" | "SA";
};

function saRole(sku: string): TwinRole | null {
  const n = normalizeSku(sku);
  if (n.endsWith("-DKT-TOP") || n.endsWith("-DKT")) return "DKT";
  if (n.endsWith("-FRAME")) return "FRAME";
  if (n.endsWith("-CUSH") || n.endsWith("-CUSHION")) return "CUSH";
  return null;
}

function saCore(sku: string): string | null {
  const n = normalizeSku(sku);
  if (!n.startsWith("SA-") && !n.startsWith("ASM-")) return null;
  const core = n
    .replace(/^(?:SA|ASM)-/, "")
    .replace(/-(?:DKT-TOP|DKT|FRAME|CUSHION|CUSH)$/, "");
  return core || null;
}

export function indexLiveMonolithicTwins(
  liveSkus: ReadonlySet<string>,
): IndexedMonolithicTwin[] {
  const out: IndexedMonolithicTwin[] = [];
  for (const raw of liveSkus) {
    const sku = normalizeSku(raw);
    if (isNonMonolithicIngredient(sku)) continue;
    const role = saRole(sku);
    if (!role) continue;
    if (role !== "DKT" && !hasDimensionToken(sku)) continue;
    const core = saCore(sku);
    if (!core) continue;
    const parts = parseFinTwinParts(`FIN-${core}`);
    if (!parts) continue;
    out.push({
      sku,
      role,
      parts,
      prefix: sku.startsWith("ASM-") ? "ASM" : "SA",
    });
  }
  return out;
}

function preferAsm(hits: readonly IndexedMonolithicTwin[]): string | null {
  const ranked = [...hits].sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix === "ASM" ? -1 : 1;
    return a.sku.localeCompare(b.sku);
  });
  return ranked[0]?.sku ?? null;
}

function twinsMatchIdentity(
  row: IndexedMonolithicTwin,
  parsed: FinTwinParts,
  role: TwinRole,
  dim: string | null,
): boolean {
  if (row.role !== role) return false;
  if (!collectionsEquivalent(row.parts.collection, parsed.collection)) return false;
  if (row.parts.category !== parsed.category) return false;
  if (Boolean(row.parts.noArm) !== Boolean(parsed.noArm)) return false;
  const allowedHands = new Set(handVariants(parsed.hand).map((h) => h ?? ""));
  if (!allowedHands.has(row.parts.hand ?? "")) return false;
  if (dim && row.parts.dimToken !== dim) return false;
  return true;
}

function uniqueLiveByModel(
  index: readonly IndexedMonolithicTwin[],
  parsed: FinTwinParts,
  role: TwinRole,
): string | null {
  const hits = index.filter((row) => twinsMatchIdentity(row, parsed, role, null));
  const dims = new Set(
    hits.map((h) => h.parts.dimToken).filter((d): d is string => Boolean(d)),
  );
  if (dims.size !== 1) return null;
  const dim = [...dims][0]!;
  return preferAsm(hits.filter((h) => h.parts.dimToken === dim));
}

function hubRoleCandidates(stem: string, role: TwinRole): string[] {
  if (role === "FRAME") return [`ASM-${stem}-FRAME`, `SA-${stem}-FRAME`];
  if (role === "CUSH") {
    return [
      `ASM-${stem}-CUSH`,
      `SA-${stem}-CUSH`,
      `ASM-${stem}-CUSHION`,
      `SA-${stem}-CUSHION`,
    ];
  }
  return [
    `ASM-${stem}-DKT`,
    `ASM-${stem}-DKT-TOP`,
    `SA-${stem}-DKT`,
    `SA-${stem}-DKT-TOP`,
  ];
}

function pickLiveSafe(
  live: ReadonlySet<string>,
  candidates: readonly string[],
): string | null {
  for (const sku of candidates) {
    const n = normalizeSku(sku);
    if (!n || !live.has(n)) continue;
    if (isNonMonolithicIngredient(n)) continue;
    if (n !== GENERIC_DEKTON_SKU && saRole(n) !== "DKT" && !hasDimensionToken(n)) {
      continue;
    }
    return n;
  }
  return null;
}

function huntRole(
  finSku: string,
  parsed: FinTwinParts,
  role: TwinRole,
  liveSkus: ReadonlySet<string>,
  index: readonly IndexedMonolithicTwin[],
): string | null {
  for (const stem of identityStemCandidates(finSku)) {
    const hit = pickLiveSafe(liveSkus, hubRoleCandidates(stem, role));
    if (hit) return hit;
  }

  for (const dim of resolvedDimTokens(parsed)) {
    const hits = index.filter((row) => twinsMatchIdentity(row, parsed, role, dim));
    const picked = preferAsm(hits);
    if (picked) return picked;
  }

  if (!parsed.dimToken) {
    const unique = uniqueLiveByModel(index, parsed, role);
    if (unique) return unique;
  }

  const fallback =
    role === "FRAME"
      ? frameCandidates(finSku)
      : role === "CUSH"
        ? cushCandidates(finSku)
        : dktCandidates(finSku);
  return pickLiveSafe(liveSkus, fallback);
}

/**
 * Phase 2 File 5: FIN → live dimensioned FRAME (+ CUSH on seating, + DKT on tables).
 * Identity is parseFinTwinParts (colors / Ocean Y|N stripped, handedness kept).
 * Only emits ingredients that exist in the live Katana SKU set.
 */
export function resolveUniversalLevel1(
  finSkuRaw: string,
  liveSkus: ReadonlySet<string>,
  index?: readonly IndexedMonolithicTwin[],
): MonolithicLevel1Edge[] {
  const finSku = normalizeSku(finSkuRaw);
  if (!finSku.startsWith("FIN-")) return [];
  if (!liveSkus.has(finSku)) return [];
  const parsed = parseFinTwinParts(finSku);
  if (!parsed) return [];
  const family = classifyFinFamily(parsed);
  if (family === "skip") return [];

  const twins = index ?? indexLiveMonolithicTwins(liveSkus);
  const frameSku = huntRole(finSku, parsed, "FRAME", liveSkus, twins);
  // A cushion or slab with no frame is not a buildable tree — emit nothing so
  // the FIN lands in the unmatched report and gets minted instead.
  if (!frameSku) return [];

  const out: MonolithicLevel1Edge[] = [];
  const push = (ingredientSku: string | null, role: TwinRole) => {
    if (!ingredientSku) return;
    if (out.some((e) => e.ingredientSku === ingredientSku)) return;
    out.push({
      productSku: finSku,
      ingredientSku,
      quantity: 1,
      role,
      live: true,
    });
  };

  push(frameSku, "FRAME");
  if (family === "seating") {
    push(huntRole(finSku, parsed, "CUSH", liveSkus, twins), "CUSH");
  }
  if (family === "table" || dektonApplicable(parsed)) {
    const dktTwin = huntRole(finSku, parsed, "DKT", liveSkus, twins);
    if (dktTwin) {
      push(dktTwin, "DKT");
    } else if (dektonApplicable(parsed) && liveSkus.has(GENERIC_DEKTON_SKU)) {
      push(GENERIC_DEKTON_SKU, "DKT");
    }
  }
  return out;
}

export type UniversalImportVerdict =
  | "add"
  | "already_live"
  | "blocked_until_purge";

export type UniversalImportRow = {
  productSku: string;
  ingredientSku: string;
  quantity: number;
  role: TwinRole;
  verdict: UniversalImportVerdict;
};

export type UniversalImportPlan = {
  /** Safe "Add new recipes" rows — nothing already on the live parent. */
  addRows: UniversalImportRow[];
  /** qty-0 rows clearing legacy ingredients the new tree replaces. */
  purgeRows: RecipeEdge[];
  /** Every planned edge with its verdict, for the audit CSV. */
  audit: UniversalImportRow[];
  stats: {
    parentsClean: number;
    parentsAlreadyLinked: number;
    parentsNeedingPurge: number;
  };
};

/**
 * Diff the universal Level 1 plan against live Katana BOM rows.
 *
 * Katana's "Add new recipes" importer APPENDS, so re-adding an ingredient the
 * parent already has duplicates it, and adding a FRAME on top of a legacy flat
 * RM tree double-counts cost. Edges already live are dropped; legacy ingredients
 * the new tree supersedes are emitted as qty-0 purge rows.
 */
export function planUniversalLevel1Import(
  edges: readonly MonolithicLevel1Edge[],
  liveBom: ReadonlyMap<string, ReadonlySet<string>>,
): UniversalImportPlan {
  const byParent = new Map<string, MonolithicLevel1Edge[]>();
  for (const edge of edges) {
    const parent = normalizeSku(edge.productSku);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(edge);
  }

  const addRows: UniversalImportRow[] = [];
  const audit: UniversalImportRow[] = [];
  const purgeRows: RecipeEdge[] = [];
  let parentsClean = 0;
  let parentsAlreadyLinked = 0;
  let parentsNeedingPurge = 0;

  for (const [parent, parentEdges] of byParent) {
    const live = liveBom.get(parent) ?? new Set<string>();
    const wanted = new Set(parentEdges.map((e) => normalizeSku(e.ingredientSku)));
    const stale = [...live].filter((sku) => !wanted.has(normalizeSku(sku)));

    if (live.size === 0) parentsClean += 1;
    else if (stale.length === 0) parentsAlreadyLinked += 1;
    else parentsNeedingPurge += 1;

    for (const sku of stale) {
      purgeRows.push({
        parentSku: parent,
        ingredientSku: normalizeSku(sku),
        quantity: 0,
      });
    }

    for (const edge of parentEdges) {
      const ingredientSku = normalizeSku(edge.ingredientSku);
      const alreadyLive = live.has(ingredientSku);
      const verdict: UniversalImportVerdict = alreadyLive
        ? "already_live"
        : stale.length > 0
          ? "blocked_until_purge"
          : "add";
      const row: UniversalImportRow = {
        productSku: parent,
        ingredientSku,
        quantity: edge.quantity,
        role: edge.role,
        verdict,
      };
      audit.push(row);
      if (!alreadyLive) addRows.push(row);
    }
  }

  purgeRows.sort((a, b) => {
    const byP = a.parentSku.localeCompare(b.parentSku);
    return byP !== 0 ? byP : a.ingredientSku.localeCompare(b.ingredientSku);
  });

  return {
    addRows,
    purgeRows,
    audit,
    stats: { parentsClean, parentsAlreadyLinked, parentsNeedingPurge },
  };
}

/** A live Katana BOM row, carrying the id needed to DELETE it. */
export type LiveBomRowRef = {
  rowId: string;
  parentSku: string;
  ingredientSku: string;
};

export type Level1PurgePlan = {
  /** Live rows to DELETE /bom_rows/{id}. */
  targets: LiveBomRowRef[];
  /** Purge rows with no matching live row — nothing to delete. */
  unresolved: RecipeEdge[];
  /**
   * Live rows that matched a purge row but are still wanted by the new tree.
   * Always empty for a correct plan; a non-empty list means abort, not proceed.
   */
  refused: LiveBomRowRef[];
};

/**
 * Resolve qty-0 purge rows onto concrete live BOM row ids.
 *
 * Katana's importer cannot clear a BOM (`POST /recipes` has `rows.minItems=1`),
 * so conflicting legacy ingredients are removed with `DELETE /bom_rows/{id}`.
 * Because that is destructive against live manufacturing data, any row the new
 * tree still wants is refused rather than deleted.
 */
export function planLevel1ConflictPurge(input: {
  purgeRows: readonly RecipeEdge[];
  liveRows: readonly LiveBomRowRef[];
  wantedEdges: readonly MonolithicLevel1Edge[];
}): Level1PurgePlan {
  const wanted = new Map<string, Set<string>>();
  for (const edge of input.wantedEdges) {
    const parent = normalizeSku(edge.productSku);
    if (!wanted.has(parent)) wanted.set(parent, new Set());
    wanted.get(parent)!.add(normalizeSku(edge.ingredientSku));
  }

  const liveByPair = new Map<string, LiveBomRowRef[]>();
  for (const row of input.liveRows) {
    const key = `${normalizeSku(row.parentSku)}|${normalizeSku(row.ingredientSku)}`;
    if (!liveByPair.has(key)) liveByPair.set(key, []);
    liveByPair.get(key)!.push(row);
  }

  const targets: LiveBomRowRef[] = [];
  const unresolved: RecipeEdge[] = [];
  const refused: LiveBomRowRef[] = [];
  const seen = new Set<string>();

  for (const purge of input.purgeRows) {
    const parent = normalizeSku(purge.parentSku);
    const ingredient = normalizeSku(purge.ingredientSku);
    const matches = liveByPair.get(`${parent}|${ingredient}`) ?? [];
    if (matches.length === 0) {
      unresolved.push({ parentSku: parent, ingredientSku: ingredient, quantity: 0 });
      continue;
    }
    for (const row of matches) {
      if (seen.has(row.rowId)) continue;
      seen.add(row.rowId);
      if (wanted.get(parent)?.has(ingredient)) {
        refused.push(row);
        continue;
      }
      targets.push({ rowId: row.rowId, parentSku: parent, ingredientSku: ingredient });
    }
  }

  targets.sort((a, b) => {
    const byParent = a.parentSku.localeCompare(b.parentSku);
    return byParent !== 0 ? byParent : a.ingredientSku.localeCompare(b.ingredientSku);
  });

  return { targets, unresolved, refused };
}

export function isClubChairFin(sku: string): boolean {
  const parsed = parseFinTwinParts(sku);
  if (!parsed) return false;
  return isClubChairCategory(parsed.category);
}

/** Known Bravada club-chair weldments to zero even if BOM fetch is thin. */
export const BRAVADA_CLUB_MODULAR_SKUS = [
  "SA-BRV-ARM",
  "ASM-BRV-ARM",
  "SA-BRV-CLB-CHA-34X34-BACK",
  "SA-BRV-CLB-CHA-34X34-SEAT",
  "ASM-BRV-CLB-CHA-34X34-BACK",
  "ASM-BRV-CLB-CHA-34X34-SEAT",
] as const;

export function heuristicClubChairPurgeEdges(
  finSku: string,
  liveSkus: ReadonlySet<string>,
): RecipeEdge[] {
  if (!isClubChairFin(finSku)) return [];
  const parent = normalizeSku(finSku);
  return BRAVADA_CLUB_MODULAR_SKUS.filter((sku) => liveSkus.has(sku)).map(
    (ingredientSku) => ({ parentSku: parent, ingredientSku, quantity: 0 }),
  );
}

export function purgeRowsFromEdges(
  edges: readonly RecipeEdge[],
): RecipeEdge[] {
  const seen = new Set<string>();
  const out: RecipeEdge[] = [];
  for (const edge of edges) {
    const parent = normalizeSku(edge.parentSku);
    const ingredient = normalizeSku(edge.ingredientSku);
    if (!parent || !ingredient) continue;
    const parentIsModular = isModularWeldmentSku(parent);
    const ingredientIsBad = isNonMonolithicIngredient(ingredient);
    if (!parentIsModular && !ingredientIsBad) continue;
    const key = `${parent}|${ingredient}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ parentSku: parent, ingredientSku: ingredient, quantity: 0 });
  }
  return out.sort((a, b) => {
    const byP = a.parentSku.localeCompare(b.parentSku);
    return byP !== 0 ? byP : a.ingredientSku.localeCompare(b.ingredientSku);
  });
}

export function uniqueFrameSkus(
  level1: readonly MonolithicLevel1Edge[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const edge of level1) {
    if (edge.role !== "FRAME") continue;
    if (seen.has(edge.ingredientSku)) continue;
    seen.add(edge.ingredientSku);
    out.push(edge.ingredientSku);
  }
  return out.sort();
}

export function buildMonolithicLevel2Lines(
  frameSkus: readonly string[],
  liveSkus: ReadonlySet<string>,
): Level2BomLine[] {
  const lines: Level2BomLine[] = [];
  for (const sku of frameSkus) {
    const plan = buildLevel2Plan(sku, liveSkus);
    lines.push(...plan.lines);
  }
  return lines;
}
