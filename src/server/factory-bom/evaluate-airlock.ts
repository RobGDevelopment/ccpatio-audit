import { AirlockDossierSchema, UNIT_OPTIONS } from "./airlock.schema";
import {
  isKatanaResource,
  normalizeKatanaResource,
  STANDARD_TRACKS,
  type TrackStep,
} from "@/lib/factory-routing/resources";
import { resolveKatanaIngredientNotes } from "@/lib/sketchup-cutlist/notes-codec";

const skuRegex = /^[A-Z0-9][A-Z0-9-]{2,64}$/;
const RELEASE_PROFILES = ["SQ2-16", "RT1.5x0.75-16", "FB0.125x1.5", "SQ2x1-16"];
const RELEASE_CONVENTIONS = ["long_point", "short_point", "square"];
const RELEASE_CONFIDENCE = ["stated", "inferred", "inferred_override"];

type LooseCut = {
  role?: unknown;
  profile?: unknown;
  lengthIn?: unknown;
  endA?: unknown;
  endB?: unknown;
  qtyEa?: unknown;
  lengthConvention?: unknown;
  sourceName?: unknown;
  confidence?: unknown;
  drawingPartNumber?: unknown;
};

type LooseLine = {
  parentSku?: unknown;
  childSku?: unknown;
  itemType?: unknown;
  quantity?: unknown;
  scrapFactor?: unknown;
  unitOfMeasure?: unknown;
  source?: unknown;
  notes?: unknown;
  cutList?: unknown;
  isMetal?: unknown;
};

type LooseOp = {
  itemSku?: unknown;
  workCenter?: unknown;
  sequence?: unknown;
  setupTimeMins?: unknown;
  runTimeMins?: unknown;
};

type LooseNode = {
  sku?: unknown;
  itemType?: unknown;
  lines?: unknown;
  operations?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asCut(value: unknown): LooseCut {
  return isRecord(value) ? value : {};
}

function asLine(value: unknown): LooseLine {
  return isRecord(value) ? value : {};
}

function asOp(value: unknown): LooseOp {
  return isRecord(value) ? value : {};
}

function asNode(value: unknown): LooseNode {
  return isRecord(value) ? value : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function blockingCodeForSchemaPath(path: string[]): string | null {
  if (path.includes("checklist")) return "CHECKLIST";
  const key = [...path].reverse().find((part) => !/^\d+$/.test(part));
  if (!key) return null;
  if (path.includes("cutList")) {
    const cutCodes: Record<string, string> = {
      role: "CUT_ROLE",
      profile: "CUT_PROFILE",
      lengthIn: "CUT_LENGTH",
      endA: "CUT_ENDS",
      endB: "CUT_ENDS",
      qtyEa: "CUT_QTY",
      lengthConvention: "CUT_CONVENTION",
      sourceName: "CUT_SOURCE",
      confidence: "CUT_CONFIDENCE",
      drawingPartNumber: "CUT_PART",
    };
    return cutCodes[key] ?? null;
  }
  if (path.includes("operations")) {
    const opCodes: Record<string, string> = {
      itemSku: "OP_SKU",
      workCenter: "OP_RESOURCE",
      sequence: "OP_SEQUENCE",
      setupTimeMins: "OP_TIME",
      runTimeMins: "OP_TIME",
    };
    return opCodes[key] ?? null;
  }
  if (path.includes("lines")) {
    const lineCodes: Record<string, string> = {
      parentSku: "PARENT_SKU",
      childSku: "CHILD_SKU",
      itemType: "CHILD_TYPE",
      quantity: "QTY",
      scrapFactor: "SCRAP",
      unitOfMeasure: "UOM",
    };
    return lineCodes[key] ?? null;
  }
  if (key === "sha256") return "CAD_HASH";
  return null;
}

function lineIsMetal(line: LooseLine, cuts: unknown[]): boolean {
  if (line.isMetal === true) return true;
  const knownProfile = cuts.some((row) => {
    const profile = asCut(row).profile;
    return typeof profile === "string" && profile.length > 0 && profile !== "UNKNOWN";
  });
  if (knownProfile) return true;
  return (line.unitOfMeasure === "in" || line.unitOfMeasure === "ft") && cuts.length > 0;
}

function coversTrack(ops: LooseOp[], steps: readonly TrackStep[]): boolean {
  return steps.every((step) =>
    ops.some((op) => op.workCenter === step.resource && op.sequence === step.sequence),
  );
}

export function evaluateAirlock(dossier: unknown): string[] {
  const codes = new Set<string>();
  const parsed = AirlockDossierSchema.safeParse(dossier);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const code = blockingCodeForSchemaPath(issue.path.map((part) => String(part)));
      if (code) codes.add(code);
    }
  }

  const root = isRecord(dossier) ? dossier : {};
  const checklist = isRecord(root.checklist) ? root.checklist : null;
  if (
    !checklist ||
    checklist.identityConfirmed !== true ||
    checklist.cutListConfirmed !== true ||
    checklist.operationsConfirmed !== true ||
    checklist.quarantineConfirmed !== true
  ) {
    codes.add("CHECKLIST");
  }

  const identity = isRecord(root.identity) ? root.identity : null;
  const cad = identity && isRecord(identity.cad) ? identity.cad : null;
  const rootSku = typeof root.rootSku === "string" ? root.rootSku : "";
  const nodes = Array.isArray(root.nodes) ? root.nodes.map(asNode) : [];

  let hasGeometrySource = false;
  let hasManagerSource = false;

  const nodeMap = new Map<string, LooseNode>();
  for (const node of nodes) {
    if (typeof node.sku === "string" && node.sku) nodeMap.set(node.sku, node);
  }

  const skusSeen = new Set<string>();
  for (const node of nodes) {
    const sku = typeof node.sku === "string" ? node.sku : "";
    if (sku && skusSeen.has(sku)) codes.add("CYCLE");
    if (sku) skusSeen.add(sku);

    const lines = Array.isArray(node.lines) ? node.lines.map(asLine) : [];
    if (lines.length === 0) codes.add("NODE_EMPTY_BOM");

    const ops = Array.isArray(node.operations) ? node.operations.map(asOp) : [];
    let validOps = 0;
    const sequences = new Set<string>();
    for (const op of ops) {
      if (typeof op.itemSku !== "string" || !op.itemSku || op.itemSku !== sku) codes.add("OP_SKU");
      const sequence = finiteNumber(op.sequence);
      if (sequence === null || !Number.isInteger(sequence) || sequence < 10 || sequence > 9990) {
        codes.add("OP_SEQUENCE");
      } else {
        const seqKey = `${typeof op.itemSku === "string" ? op.itemSku : ""}:${sequence}`;
        if (sequences.has(seqKey)) codes.add("OP_SEQUENCE");
        sequences.add(seqKey);
      }

      const workCenter = typeof op.workCenter === "string" ? op.workCenter : "";
      const normalized = workCenter ? normalizeKatanaResource(workCenter) : "";
      if (!workCenter || !isKatanaResource(normalized) || normalized !== workCenter) {
        codes.add("OP_RESOURCE");
      }

      const setupMins = op.setupTimeMins === undefined ? 0 : finiteNumber(op.setupTimeMins);
      const runMins = op.runTimeMins === undefined ? 0 : finiteNumber(op.runTimeMins);
      if (
        setupMins === null ||
        runMins === null ||
        setupMins < 0 ||
        runMins < 0 ||
        setupMins > 100000 ||
        runMins > 100000
      ) {
        codes.add("OP_TIME");
        continue;
      }
      if (setupMins === 0 && runMins === 0) {
        codes.add("OP_TIME");
        continue;
      }

      let emitted = 0;
      if (setupMins > 0) {
        const setupSec = Math.round(setupMins * 60);
        if (setupSec < 1) codes.add("OP_SECONDS");
        else emitted += 1;
      }
      if (runMins > 0) {
        const runSec = Math.round(runMins * 60);
        if (runSec < 1) codes.add("OP_SECONDS");
        else emitted += 1;
      }
      if (emitted === 0) codes.add("OP_TIME");
      else validOps += 1;
    }
    if (validOps === 0) codes.add("NODE_EMPTY_OPS");

    if (sku.endsWith("-FRAME")) {
      if (!coversTrack(ops, STANDARD_TRACKS.aluminum_frame)) codes.add("TRACK_FRAME");
    }
    if (sku.endsWith("-CUSH")) {
      if (!coversTrack(ops, STANDARD_TRACKS.cushion)) codes.add("TRACK_CUSH");
    }
    if (sku === rootSku && node.itemType === "finished_good") {
      if (!coversTrack(ops, STANDARD_TRACKS.final_assembly)) codes.add("TRACK_FIN");
    }
    if (sku.includes("-DEKTON") || sku.includes("-STONE")) {
      if (!coversTrack(ops, STANDARD_TRACKS.dekton_top)) codes.add("TRACK_STONE");
    }

    const edgeSeen = new Set<string>();
    for (const line of lines) {
      const parentSku = typeof line.parentSku === "string" ? line.parentSku : "";
      const childSku = typeof line.childSku === "string" ? line.childSku : "";
      if (!skuRegex.test(parentSku)) codes.add("PARENT_SKU");
      if (!skuRegex.test(childSku) || childSku === parentSku) codes.add("CHILD_SKU");
      if (line.itemType !== "raw_material" && line.itemType !== "sub_assembly") codes.add("CHILD_TYPE");
      if (line.itemType === "sub_assembly" && !nodeMap.has(childSku)) codes.add("CHILD_NODE_MISSING");

      const quantity = finiteNumber(line.quantity);
      const scrapFactor = finiteNumber(line.scrapFactor);
      if (quantity === null || quantity <= 0 || quantity > 1000000) codes.add("QTY");
      if (scrapFactor === null || scrapFactor <= 0 || scrapFactor > 10) codes.add("SCRAP");
      if (quantity !== null && scrapFactor !== null) {
        const effective = quantity * scrapFactor;
        if (!(effective > 0) || !Number.isFinite(effective)) codes.add("EFFECTIVE_QTY");
      }
      if (typeof line.unitOfMeasure !== "string" || !UNIT_OPTIONS.includes(line.unitOfMeasure as (typeof UNIT_OPTIONS)[number])) {
        codes.add("UOM");
      }

      if (line.source === "sketchup_geometry") hasGeometrySource = true;
      if (line.source === "manager") hasManagerSource = true;

      const edge = `${parentSku}->${childSku}`;
      if (edgeSeen.has(edge)) codes.add("DUP_EDGE");
      edgeSeen.add(edge);

      const cuts = Array.isArray(line.cutList) ? line.cutList : [];
      const metal = lineIsMetal(line, cuts);
      if (metal) {
        if (cuts.length === 0) codes.add("CUT_UNEXPECTED");
      } else if (cuts.length > 0) {
        codes.add("CUT_UNEXPECTED");
      }

      for (const row of cuts) {
        const cut = asCut(row);
        if (typeof cut.role !== "string" || cut.role.length === 0 || cut.role.length > 80) codes.add("CUT_ROLE");
        if (typeof cut.profile !== "string" || !RELEASE_PROFILES.includes(cut.profile)) codes.add("CUT_PROFILE");
        const lengthIn = finiteNumber(cut.lengthIn);
        if (lengthIn === null || lengthIn <= 0 || lengthIn > 10000) codes.add("CUT_LENGTH");
        if (cut.endA !== 45 && cut.endA !== 90) codes.add("CUT_ENDS");
        if (cut.endB !== 45 && cut.endB !== 90) codes.add("CUT_ENDS");
        if (typeof cut.qtyEa !== "number" || !Number.isInteger(cut.qtyEa) || cut.qtyEa < 1 || cut.qtyEa > 10000) {
          codes.add("CUT_QTY");
        }
        if (typeof cut.lengthConvention !== "string" || !RELEASE_CONVENTIONS.includes(cut.lengthConvention)) {
          codes.add("CUT_CONVENTION");
        }
        if (typeof cut.sourceName !== "string" || cut.sourceName.length === 0 || cut.sourceName.length > 240) {
          codes.add("CUT_SOURCE");
        }
        if (typeof cut.confidence !== "string" || !RELEASE_CONFIDENCE.includes(cut.confidence)) {
          codes.add("CUT_CONFIDENCE");
        }
        const part = cut.drawingPartNumber;
        if (part == null || part === "") {
          if (metal) codes.add("CUT_PART");
        } else if (typeof part !== "string" || part.length > 64) {
          codes.add("CUT_PART");
        }
      }

      const notes = typeof line.notes === "string" || line.notes == null ? line.notes : null;
      const resolved = resolveKatanaIngredientNotes({ notes, cutList: line.cutList });
      if (resolved.trim().length > 255) codes.add("NOTE_TOO_LONG");
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfs = (sku: string): boolean => {
    if (stack.has(sku)) return true;
    if (visited.has(sku)) return false;
    visited.add(sku);
    stack.add(sku);
    const node = nodeMap.get(sku);
    const lines = node && Array.isArray(node.lines) ? node.lines.map(asLine) : [];
    for (const line of lines) {
      if (line.itemType === "sub_assembly" && typeof line.childSku === "string" && dfs(line.childSku)) {
        return true;
      }
    }
    stack.delete(sku);
    return false;
  };
  for (const sku of nodeMap.keys()) {
    if (dfs(sku)) {
      codes.add("CYCLE");
      break;
    }
  }

  if (!cad && (hasGeometrySource || !hasManagerSource)) codes.add("CAD_REQUIRED");
  if (cad) {
    const sha = cad.sha256;
    if (typeof sha !== "string" || !/^[0-9a-fA-F]{64}$/.test(sha)) codes.add("CAD_HASH");
    if (cad.hygiene === "fail" && hasGeometrySource) codes.add("GEOM_MIXED");
  }

  return Array.from(codes);
}
