/**
 * Parametric catch-up recipes for in-house collections that do not have a
 * Day Zero OBJ cut-list. Pure: no Katana and no Postgres.
 *
 * Quantities follow docs/KATANA_HEURISTIC_BOM_PLAN.md. Scrap is baked into
 * the posted quantity. Callers store hub scrap_factor as 1.
 */
import { stripVariantSuffix } from "@/lib/collection-catalog";
import {
  RM_CAP_2X2,
  RM_DKT_GENERIC,
  RM_FAB_GENERIC,
  RM_FOAM,
  RM_TUBING_2X2,
  classifyFamily,
  fabricYards,
  foamBoardFeet,
  powderPounds,
  subAssemblySku,
  tubingFeet,
} from "@/lib/heuristic-bom";
import {
  LEVEL2_SCRAP,
  RM_MET_FLATBAR,
  legCountFromWidth,
  seatingFlatbarFeet,
  tableHeightIn,
} from "@/lib/level2-bom";
import { DAY_ZERO_POWDER_PREFERRED, powderFallbackSku } from "@/lib/day-zero-bom";

export const HEURISTIC_SOFA_84_SKU = "FIN-BRV-SOF-84X34";
export const HEURISTIC_POWDER_PREFERRED = DAY_ZERO_POWDER_PREFERRED;
export const HEURISTIC_POWDER_FALLBACK = powderFallbackSku();

export const TARGET_PREFIXES = [
  "FIN-BRV-",
  "FIN-BRK-",
  "FIN-OCN-",
  "FIN-MLN-",
  "FIN-TAY-",
  "FIN-DAI-",
  "FIN-WFT-",
] as const;

const TARGET_WORDS = [
  "bravada",
  "brooklyn",
  "ocean",
  "milan",
  "taylor",
  "daisy",
  "waterfall",
] as const;

const SEATING_TOKENS = new Set([
  "SOF",
  "LOV",
  "CHA",
  "CHS",
  "OTT",
  "DYB",
  "BCH",
  "BST",
  "SWG",
  "CC",
]);

const BLOCK_PREFIXES = ["FIN-TJM-", "FIN-UMB-", "FIN-CAB-", "FIN-ESY-", "TJM-", "UMB-", "CAB-", "ESY-"];

export type HeuristicFamily = "seating" | "table" | "skip";

export type HeuristicCatalogRow = {
  ingredientSku: string;
  quantity: number;
  uom: string;
  notes: string;
  cutList: [];
};

export type HeuristicCatalogParent = {
  role: "frame" | "cushion" | "finished_good";
  sku: string;
  rows: HeuristicCatalogRow[];
};

export type HeuristicCatalogDocument = {
  status: "ready" | "skipped";
  skipReason: string | null;
  finSku: string;
  name: string;
  category: string;
  family: HeuristicFamily;
  dimSource: string | null;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  tubeNetFt: number;
  frameSku: string | null;
  cushionSku: string | null;
  powderSku: string;
  parents: HeuristicCatalogParent[];
};

export type DayZeroQuarantineFile = {
  status?: string;
  finSku?: string | null;
  frameSku?: string | null;
  cushionSku?: string | null;
};

export type CatalogCandidate = {
  finSku: string;
  name: string;
  category: string;
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function tokensOf(sku: string): string[] {
  return sku.trim().toUpperCase().split("-").filter(Boolean);
}

function row(
  ingredientSku: string,
  quantity: number,
  uom: string,
  notes: string,
): HeuristicCatalogRow {
  return {
    ingredientSku,
    quantity: round4(quantity),
    uom,
    notes,
    cutList: [],
  };
}

export function loadDayZeroQuarantine(files: readonly DayZeroQuarantineFile[]): Set<string> {
  const skus = new Set<string>();
  for (const file of files) {
    if (file.status !== "ready") continue;
    for (const sku of [file.finSku, file.frameSku, file.cushionSku]) {
      const normalized = sku?.trim().toUpperCase();
      if (normalized) skus.add(normalized);
    }
  }
  return skus;
}

export function finishedGoodsInQuarantine(
  files: readonly DayZeroQuarantineFile[],
): Set<string> {
  const skus = new Set<string>();
  for (const file of files) {
    if (file.status !== "ready") continue;
    const fin = file.finSku?.trim().toUpperCase();
    if (fin) skus.add(fin);
  }
  return skus;
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(haystack);
}

export function thirdPartyBlockReason(
  category: string,
  name: string,
  sku: string,
): string | null {
  const normalizedSku = sku.trim().toUpperCase();
  const haystack = `${category} ${name}`;
  if (BLOCK_PREFIXES.some((prefix) => normalizedSku.startsWith(prefix))) {
    return "third_party";
  }
  if (hasWord(haystack, "tenjam")) return "third_party";
  if (/ledge\s*lounger/i.test(haystack)) return "third_party";
  if (hasWord(haystack, "umbrella") || hasWord(haystack, "umbrellas")) return "third_party";
  if (hasWord(category, "cabana") || hasWord(category, "cabanas")) return "third_party";
  if (hasWord(haystack, "flexy")) return "third_party";
  if (hasWord(haystack, "marina")) return "third_party";
  if (/kindle/i.test(haystack)) return "third_party";
  if (/fire\s*glass/i.test(haystack)) return "third_party";
  return null;
}

export function isFirepitBase(category: string, name: string, sku: string): boolean {
  const haystack = `${category} ${name} ${sku}`.toUpperCase();
  const fire = /FIRE\s*PIT|FIREPIT/.test(haystack) || haystack.includes("FRP-") || haystack.includes("-FRP-");
  const base = /\bBASE\b/.test(haystack) || haystack.includes("-BASE") || haystack.includes("FRP-");
  return fire && base;
}

export function isTargetCollection(category: string, name: string, sku: string): boolean {
  const normalizedSku = stripVariantSuffix(sku).toUpperCase();
  if (TARGET_PREFIXES.some((prefix) => normalizedSku.startsWith(prefix))) return true;
  const haystack = `${category} ${name}`.toLowerCase();
  if (hasWord(haystack, "marina")) return false;
  return TARGET_WORDS.some((word) => haystack.includes(word));
}

export function parseFinDimensions(sku: string): {
  widthIn: number;
  depthIn: number;
  dimSource: string;
} | null {
  for (const token of tokensOf(sku)) {
    const pair = /^(\d{2,3})X(\d{2,3})$/.exec(token);
    if (!pair) continue;
    const widthIn = Number(pair[1]);
    const depthIn = Number(pair[2]);
    if (widthIn < 8 || depthIn < 8) return null;
    return { widthIn, depthIn, dimSource: token };
  }
  return null;
}

export function familyForCatalogItem(sku: string, name: string): HeuristicFamily {
  const named = classifyFamily(`${name} ${sku.replace(/-/g, " ")}`);
  if (named !== "skip") return named;
  const tokens = tokensOf(sku);
  if (tokens.some((token) => SEATING_TOKENS.has(token))) return "seating";
  if (tokens.includes("TAB") || tokens.includes("TABLE") || tokens.includes("BASE")) return "table";
  return "skip";
}

function skipped(
  input: CatalogCandidate,
  reason: string,
  powderSku: string,
): HeuristicCatalogDocument {
  return {
    status: "skipped",
    skipReason: reason,
    finSku: input.finSku.trim().toUpperCase(),
    name: input.name,
    category: input.category,
    family: "skip",
    dimSource: null,
    widthIn: null,
    depthIn: null,
    heightIn: null,
    tubeNetFt: 0,
    frameSku: null,
    cushionSku: null,
    powderSku,
    parents: [],
  };
}

export function buildHeuristicCatalogDocument(
  input: CatalogCandidate,
  options?: { powderSku?: string; quarantine?: ReadonlySet<string> },
): HeuristicCatalogDocument {
  const finSku = stripVariantSuffix(input.finSku).toUpperCase();
  const powderSku = options?.powderSku ?? HEURISTIC_POWDER_PREFERRED;
  const candidate = { ...input, finSku };
  const quarantine = options?.quarantine;
  if (quarantine?.has(finSku)) return skipped(candidate, "day_zero", powderSku);

  const blocked = thirdPartyBlockReason(input.category, input.name, finSku);
  if (blocked) return skipped(candidate, blocked, powderSku);
  if (
    !isTargetCollection(input.category, input.name, finSku) &&
    !isFirepitBase(input.category, input.name, finSku)
  ) {
    return skipped(candidate, "not_target", powderSku);
  }

  const family = familyForCatalogItem(finSku, input.name);
  if (family === "skip") return skipped(candidate, "accessory", powderSku);

  const dims = parseFinDimensions(finSku);
  if (!dims) return skipped(candidate, "missing_dimensions", powderSku);

  const tokens = tokensOf(finSku);
  const heightIn = family === "table" ? tableHeightIn(tokens) : 0;
  const tubeNetFt = tubingFeet(dims.widthIn, dims.depthIn, heightIn);
  const postedTubeFt = round4(tubeNetFt * LEVEL2_SCRAP);
  const frameSku = subAssemblySku(finSku, "FRAME");
  const cushionSku = family === "seating" ? subAssemblySku(finSku, "CUSH") : null;
  const caps = legCountFromWidth(dims.widthIn);
  const powderLb = round4(powderPounds(tubeNetFt) * 1.05);
  const heightLabel = heightIn > 0 ? String(heightIn) : "30";

  const frameRows: HeuristicCatalogRow[] = [
    row(
      RM_TUBING_2X2,
      postedTubeFt,
      "ft",
      `tubingFeet(${dims.widthIn}x${dims.depthIn}x${heightLabel}) ${tubeNetFt} × 1.08`,
    ),
  ];
  if (family === "seating") {
    frameRows.push(
      row(
        RM_MET_FLATBAR,
        seatingFlatbarFeet(dims.widthIn),
        "ft",
        `seatingFlatbarFeet(${dims.widthIn})`,
      ),
    );
  }
  frameRows.push(
    row(RM_CAP_2X2, caps, "ea", `${caps} legs`),
    row(
      powderSku,
      powderLb,
      "lb",
      `powderPounds(${tubeNetFt}) × 1.05`,
    ),
  );
  if (family === "table" && (/dekton|fire/i.test(`${input.name} ${finSku}`) || tokens.includes("FIR"))) {
    frameRows.push(
      row(RM_DKT_GENERIC, 1, "slab", "MTO dekton placeholder — swap STN-* at order time"),
    );
  }

  const parents: HeuristicCatalogParent[] = [
    { role: "frame", sku: frameSku, rows: frameRows },
  ];
  if (cushionSku) {
    const fabric = round4(fabricYards(dims.widthIn, dims.depthIn, 0, false) * 1.1);
    const foam = round4(foamBoardFeet(dims.widthIn, dims.depthIn) * 1.05);
    parents.push({
      role: "cushion",
      sku: cushionSku,
      rows: [
        row(RM_FAB_GENERIC, fabric, "yd", "MTO fabric placeholder — swap FAB-* at order time"),
        row(RM_FOAM, foam, "boardft", "4in seat slab"),
      ],
    });
  }
  const finishedRows: HeuristicCatalogRow[] = [
    row(frameSku, 1, "ea", "FG consumes one welded frame"),
  ];
  if (cushionSku) {
    finishedRows.push(row(cushionSku, 1, "ea", "FG consumes one cushion set"));
  }
  parents.push({ role: "finished_good", sku: finSku, rows: finishedRows });

  return {
    status: "ready",
    skipReason: null,
    finSku,
    name: input.name,
    category: input.category,
    family,
    dimSource: dims.dimSource,
    widthIn: dims.widthIn,
    depthIn: dims.depthIn,
    heightIn: heightIn > 0 ? heightIn : 30,
    tubeNetFt,
    frameSku,
    cushionSku,
    powderSku,
    parents,
  };
}

export function baseModelSku(sku: string): string {
  return stripVariantSuffix(sku).toUpperCase();
}
