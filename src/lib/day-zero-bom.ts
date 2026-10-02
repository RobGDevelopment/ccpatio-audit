/**
 * Day Zero recipe document. Metal quantities come from the OBJ review
 * (`katanaQuantityFt` already includes 1.08). Soft goods use the heuristic
 * formulas once. Nothing in this module talks to Katana or Postgres.
 */
import {
  RM_CAP_2X2,
  RM_DKT_GENERIC,
  RM_FAB_GENERIC,
  RM_FOAM,
  RM_PWD_GENERIC,
  classifyFamily,
  fabricYards,
  foamBoardFeet,
  powderPounds,
  subAssemblySku,
} from "@/lib/heuristic-bom";
import { DEFAULT_SEATING_DEPTH_IN, OCEAN_SEATING_DEPTH_IN, legCountFromWidth } from "@/lib/level2-bom";
import { truncateKatanaBomRowNotes } from "@/lib/katana-bom-rows";

export const DAY_ZERO_POWDER_PREFERRED = "PWD-BLACK";
export const CLUB_CHAIR_OBJ = "1 BRAVADA club chair.obj";

export type DayZeroCut = {
  qtyEa: number;
  longPointIn: number;
  shortPointIn: number | null;
  endA: 45 | 90;
  endB: 45 | 90;
  compoundLongEdges: boolean;
};

export type DayZeroReviewRecipe = {
  recipeSku: string | null;
  profileCode: string;
  netFt: number;
  katanaQuantityFt: number;
  cuts: DayZeroCut[];
};

export type DayZeroReviewFile = {
  file: string;
  finCandidate: string;
  status: string;
  draftEligible: boolean;
  recipes: DayZeroReviewRecipe[];
};

export type DayZeroRow = {
  ingredientSku: string;
  quantity: number;
  uom: string;
  notes: string;
  cutList: Array<{
    role: string;
    profile: string;
    lengthIn: number;
    endA: number | null;
    endB: number | null;
    qtyEa: number;
    lengthConvention: string;
    sourceName: string;
    confidence: string;
    drawingPartNumber: string | null;
  }>;
};

export type DayZeroParent = {
  role: "frame" | "cushion" | "finished_good";
  sku: string;
  rows: DayZeroRow[];
};

export type DayZeroDocument = {
  file: string;
  status: "ready" | "skipped";
  skipReason: string | null;
  dimSource: "filename" | "filename_width_default_depth" | "catalog_default" | null;
  widthIn: number | null;
  depthIn: number | null;
  family: "seating" | "table" | "skip";
  /** Live lookup order. First hit wins. Last entry is the approved base when no size is in the filename. */
  finCandidates: string[];
  finSku: string | null;
  frameSku: string | null;
  cushionSku: string | null;
  tubeNetFt: number;
  scrapIncludedInQuantity: true;
  parents: DayZeroParent[];
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatInches(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatCutListNote(cuts: DayZeroCut[]): string {
  const text = cuts
    .map((cut) => {
      let note = `${cut.qtyEa}x${formatInches(cut.longPointIn)}" ${cut.endA}/${cut.endB}`;
      if (cut.shortPointIn != null) note += ` short ${formatInches(cut.shortPointIn)}`;
      if (cut.compoundLongEdges) note += " compound";
      return note;
    })
    .join("; ");
  return truncateKatanaBomRowNotes(text) ?? "";
}

export function parseCatalogDimensions(fileName: string): {
  widthIn: number;
  depthIn: number;
  dimSource: DayZeroDocument["dimSource"];
} {
  const stem = fileName.replace(/\.obj$/i, "").replace(/^\d+\s+/, "");
  const pair = stem.match(/(\d{2,3})\s*[xX×]\s*(\d{2,3})/);
  if (pair) {
    return {
      widthIn: Number(pair[1]),
      depthIn: Number(pair[2]),
      dimSource: "filename",
    };
  }
  const single = stem.match(/\b(\d{2,3})\b/);
  const ocean = /ocean/i.test(stem);
  const defaultDepth = ocean ? OCEAN_SEATING_DEPTH_IN : DEFAULT_SEATING_DEPTH_IN;
  if (single) {
    return {
      widthIn: Number(single[1]),
      depthIn: defaultDepth,
      dimSource: "filename_width_default_depth",
    };
  }
  return {
    widthIn: DEFAULT_SEATING_DEPTH_IN,
    depthIn: defaultDepth,
    dimSource: "catalog_default",
  };
}

function sizedFinSku(finCandidate: string, widthIn: number, depthIn: number): string {
  if (/\d{2,3}X\d{2,3}$/i.test(finCandidate)) return finCandidate.toUpperCase();
  return `${finCandidate}-${widthIn}X${depthIn}`;
}

export function finLookupOrder(
  finCandidate: string,
  widthIn: number,
  depthIn: number,
  dimSource: DayZeroDocument["dimSource"],
): string[] {
  const base = finCandidate.trim().toUpperCase();
  const sized = sizedFinSku(base, widthIn, depthIn);
  if (dimSource === "catalog_default") {
    return sized === base ? [base] : [sized, base];
  }
  return sized === base ? [base] : [base, sized];
}

function tubeNetFt(recipes: DayZeroReviewRecipe[]): number {
  return round4(
    recipes
      .filter((recipe) => recipe.recipeSku?.startsWith("MET-") && !recipe.profileCode.startsWith("FB"))
      .reduce((sum, recipe) => sum + recipe.netFt, 0),
  );
}

function metalRows(file: DayZeroReviewFile): DayZeroRow[] {
  return file.recipes
    .filter((recipe) => recipe.recipeSku?.startsWith("MET-"))
    .map((recipe) => ({
      ingredientSku: recipe.recipeSku!,
      quantity: recipe.katanaQuantityFt,
      uom: "ft",
      notes: formatCutListNote(recipe.cuts),
      cutList: recipe.cuts.map((cut) => ({
        role: recipe.profileCode,
        profile: recipe.profileCode,
        lengthIn: cut.longPointIn,
        endA: cut.endA,
        endB: cut.endB,
        qtyEa: cut.qtyEa,
        lengthConvention: cut.shortPointIn == null && cut.endA === 90 ? "square" : "long_point",
        sourceName: file.file,
        confidence: "obj_edge",
        drawingPartNumber: null,
      })),
    }));
}

function skip(file: DayZeroReviewFile, reason: string): DayZeroDocument {
  return {
    file: file.file,
    status: "skipped",
    skipReason: reason,
    dimSource: null,
    widthIn: null,
    depthIn: null,
    family: "skip",
    finCandidates: [],
    finSku: null,
    frameSku: null,
    cushionSku: null,
    tubeNetFt: 0,
    scrapIncludedInQuantity: true,
    parents: [],
  };
}

/**
 * Build the FG / frame / cushion document for one review file.
 * `finSku` is the resolved finished-good SKU. When omitted, the preferred
 * candidate (sized variant first on a catalog default) is used so a dry-run
 * can still show the tree before the live lookup.
 */
export function buildDayZeroDocument(
  file: DayZeroReviewFile,
  finSku?: string,
): DayZeroDocument {
  if (file.status === "fused_mesh" || file.status === "no_metal") {
    return skip(file, file.status);
  }
  if (!file.draftEligible) {
    return skip(file, "not_draft_eligible");
  }
  if (file.recipes.some((recipe) => recipe.recipeSku == null)) {
    return skip(file, "unmapped_metal");
  }

  const stem = file.file.replace(/\.obj$/i, "").replace(/^\d+\s+/, "");
  const family = classifyFamily(stem);
  const dims = parseCatalogDimensions(file.file);
  const candidates = finLookupOrder(
    file.finCandidate,
    dims.widthIn,
    dims.depthIn,
    dims.dimSource,
  );
  const resolvedFin = (finSku ?? candidates[0] ?? file.finCandidate).trim().toUpperCase();
  const frameSku = subAssemblySku(resolvedFin, "FRAME");
  const cushionSku = family === "seating" ? subAssemblySku(resolvedFin, "CUSH") : null;
  const tubes = tubeNetFt(file.recipes);
  const frameRows = metalRows(file);

  frameRows.push({
    ingredientSku: RM_CAP_2X2,
    quantity: legCountFromWidth(dims.widthIn),
    uom: "ea",
    notes: `${legCountFromWidth(dims.widthIn)} legs`,
    cutList: [],
  });

  if (tubes > 0) {
    const powderNet = powderPounds(tubes);
    frameRows.push({
      ingredientSku: DAY_ZERO_POWDER_PREFERRED,
      quantity: round4(powderNet * 1.05),
      uom: "lb",
      notes: `powderPounds(${tubes} tube ft) × 1.05`,
      cutList: [],
    });
  }

  if (family === "table" && /dekton|fire/i.test(stem)) {
    frameRows.push({
      ingredientSku: RM_DKT_GENERIC,
      quantity: 1,
      uom: "slab",
      notes: "MTO dekton placeholder — swap STN-* at order time",
      cutList: [],
    });
  }

  const parents: DayZeroParent[] = [
    { role: "frame", sku: frameSku, rows: frameRows },
  ];

  if (cushionSku) {
    parents.push({
      role: "cushion",
      sku: cushionSku,
      rows: [
        {
          ingredientSku: RM_FAB_GENERIC,
          quantity: round4(
            fabricYards(dims.widthIn, dims.depthIn, 0, false) * 1.1,
          ),
          uom: "yd",
          notes: "MTO fabric placeholder — swap FAB-* at order time",
          cutList: [],
        },
        {
          ingredientSku: RM_FOAM,
          quantity: round4(foamBoardFeet(dims.widthIn, dims.depthIn) * 1.05),
          uom: "boardft",
          notes: "4in seat slab",
          cutList: [],
        },
      ],
    });
  }

  const finishedRows: DayZeroRow[] = [
    {
      ingredientSku: frameSku,
      quantity: 1,
      uom: "ea",
      notes: "FG consumes one welded frame",
      cutList: [],
    },
  ];
  if (cushionSku) {
    finishedRows.push({
      ingredientSku: cushionSku,
      quantity: 1,
      uom: "ea",
      notes: "FG consumes one cushion set",
      cutList: [],
    });
  }
  parents.push({ role: "finished_good", sku: resolvedFin, rows: finishedRows });

  return {
    file: file.file,
    status: "ready",
    skipReason: null,
    dimSource: dims.dimSource,
    widthIn: dims.widthIn,
    depthIn: dims.depthIn,
    family,
    finCandidates: candidates,
    finSku: resolvedFin,
    frameSku,
    cushionSku,
    tubeNetFt: tubes,
    scrapIncludedInQuantity: true,
    parents,
  };
}

export function applyResolvedFin(
  file: DayZeroReviewFile,
  resolvedFinSku: string,
): DayZeroDocument {
  return buildDayZeroDocument(file, resolvedFinSku);
}

export function powderFallbackSku(): string {
  return RM_PWD_GENERIC;
}
