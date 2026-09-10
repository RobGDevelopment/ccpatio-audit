/**
 * SketchUp cut-list extraction types (bulk backfill → product_bom_draft).
 * North Star: docs/BOM_Examples/BOM_BRV-CLB-034034.csv
 */

export type CutEndAngle = 45 | 90 | null;

export type ProfileCode =
  | "SQ2-16"
  | "RT1.5x0.75-16"
  | "FB0.125x1.5"
  | "SQ2x1-16"
  | "UNKNOWN";

export type LengthConvention = "long_point" | "short_point" | "square" | "unknown";

export type AuditBucket = "named_cut_strings" | "nested_groups" | "exploded_soup";

export type ParsedComponentName = {
  rawName: string;
  roleHint: string;
  profile: ProfileCode;
  profileWidthIn: number;
  gauge: string | null;
  nameLengthIn: number | null;
  endA: CutEndAngle;
  endB: CutEndAngle;
  looksLikeCut: boolean;
};

export type WalkerStick = {
  definitionName: string;
  parentAsmName: string | null;
  instanceCount: number;
  nameLengthIn: number | null;
  obbLengthIn: number | null;
  endA: CutEndAngle;
  endB: CutEndAngle;
  profile: ProfileCode;
  profileWidthIn: number;
  materialName: string | null;
  confidence: "stated" | "inferred" | "low";
};

export type WalkerExport = {
  sourceFile: string;
  exportedAt: string;
  productHint: string | null;
  overall: { lengthIn: number | null; depthIn: number | null; heightIn: number | null };
  assemblies: Array<{ name: string; instanceCount: number }>;
  sticks: WalkerStick[];
  flags: string[];
  auditBucket: AuditBucket;
};

export type CutLine = {
  role: string;
  profile: ProfileCode;
  lengthIn: number;
  endA: CutEndAngle;
  endB: CutEndAngle;
  qtyEa: number;
  lengthConvention: LengthConvention;
  sourceName: string;
  confidence: string;
  drawingPartNumber: string | null;
};

export type DraftBomLine = {
  parentSku: string;
  childSku: string;
  quantity: number;
  scrapFactor: number;
  unitOfMeasure: string;
  notes: string;
  cutList: CutLine[];
};

export type InstantiatedPlan = {
  finSku: string;
  /** Bravada seat / Waterfall base weldment. */
  seatSku: string;
  armSku: string | null;
  backSku: string | null;
  cushSku: string | null;
  /** Alias used by table templates (same as seatSku when BASE). */
  baseSku?: string | null;
  hubSkus: Array<{
    globalSku: string;
    itemType: "finished_good" | "sub_assembly";
    originalName: string;
    category: string;
  }>;
  lines: DraftBomLine[];
  flags: string[];
};
