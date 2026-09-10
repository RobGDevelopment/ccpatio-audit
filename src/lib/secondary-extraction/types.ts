/** Shared types for Secondary Extraction (draft-only estimates). */

export type CutListPiece = {
  lengthIn: number;
  qtyEa: number;
  profileCode?: string;
};

export type DraftLineInput = {
  parentSku: string;
  childSku: string;
  quantity: number;
  scrapFactor: number;
  unitOfMeasure: string;
  notes: string | null;
  cutList: CutListPiece[];
};

export type PhysicsFactor = {
  materialSku: string;
  profileCode: string;
  weightPlf: number | null;
  densityPcf: number | null;
  ozPerYd2: number | null;
  fabricWidthIn: number | null;
  perimeterIn: number | null;
  coverageSqftPerLb: number | null;
  /** Override from sku_mappings.attributes.weight_plf when present. */
  attrWeightPlf: number | null;
};

export type FgEnvelope = {
  lengthIn: number;
  depthIn: number;
  heightIn: number;
};

export type WeightBreakdown = {
  metal: number;
  foam: number;
  fabric: number;
  powder: number;
  hardware: number;
};

export type PackagingLine = {
  sku: string;
  qty: number;
  uom: string;
  role: string;
};

export type PackagingResult = {
  cartonIn: { l: number; w: number; h: number };
  lines: PackagingLine[];
  dimWeightLbs: number;
  dimDivisor: number;
  packCost: number | null;
};

export type LaborOpEstimate = {
  workCenter: string;
  sequence: number;
  setupTimeMins: number;
  runTimeMins: number;
  drivers: Record<string, number>;
};

export type LaborResult = {
  totalMinutes: number;
  ops: LaborOpEstimate[];
};

export type GeometryDrivers = {
  nPieces: number;
  nCuts: number;
  tubeFt: number;
  nJoints: number;
  metalAreaFt2: number;
  fabricYd: number;
  foamBoardFt: number;
};

export const CALC_VERSION = "1";
export const HARDWARE_LB_EACH = 0.05;
export const FOAM_THICKNESS_IN = 4;
export const DEFAULT_PAD_IN = 2;
export const FLAP_FACTOR = 1.15;
export const WRAP_TURNS = 8;
export const DIM_DIVISOR = 139;
export const CORRUGATE_COST_PER_SQFT = 0.35;
export const EDGE_COST_PER_FT = 0.45;
export const STRETCH_COST_PER_FT = 0.08;
