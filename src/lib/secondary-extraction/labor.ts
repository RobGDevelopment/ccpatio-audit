import type {
  DraftLineInput,
  GeometryDrivers,
  LaborResult,
  PhysicsFactor,
} from "./types";
import {
  sumCutListFeet,
  sumCutListPieces,
  sumMetalAreaFt2,
} from "./parse-notes";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function factorPerimeter(
  factors: PhysicsFactor[],
  sku: string,
  profile?: string,
): number {
  const upper = sku.toUpperCase();
  const hit =
    factors.find(
      (f) =>
        f.materialSku === upper &&
        profile &&
        f.profileCode.toUpperCase() === profile.toUpperCase(),
    ) ??
    factors.find((f) => f.materialSku === upper && f.profileCode === "") ??
    factors.find((f) => f.materialSku === upper);
  return hit?.perimeterIn ?? 8;
}

export function deriveGeometryDrivers(input: {
  lines: DraftLineInput[];
  factors: PhysicsFactor[];
}): GeometryDrivers {
  let nPieces = 0;
  let tubeFt = 0;
  let metalAreaFt2 = 0;
  let fabricYd = 0;
  let foamBoardFt = 0;

  for (const line of input.lines) {
    const sku = line.childSku.toUpperCase();
    const uom = line.unitOfMeasure.toLowerCase();
    const scrap = line.scrapFactor > 0 ? line.scrapFactor : 1;

    if (line.cutList.length > 0) {
      nPieces += sumCutListPieces(line.cutList);
      tubeFt += sumCutListFeet(line.cutList) * scrap;
      const peri = factorPerimeter(
        input.factors,
        line.childSku,
        line.cutList[0]?.profileCode,
      );
      metalAreaFt2 += sumMetalAreaFt2(line.cutList, peri) * scrap;
    } else if (
      (sku.includes("MET") || sku.includes("TUBING")) &&
      uom === "ft"
    ) {
      tubeFt += line.quantity * scrap;
      const peri = factorPerimeter(input.factors, line.childSku);
      metalAreaFt2 += ((peri * line.quantity * 12) / 144) * scrap;
      // Heuristic piece count: ~1 piece per 2 ft when no cut list
      nPieces += Math.max(1, Math.round(line.quantity / 2));
    }

    if (sku.includes("FAB") || sku.startsWith("FAB-")) {
      if (uom === "yd" || uom === "yds") fabricYd += line.quantity * scrap;
    }
    if (sku.includes("FOAM")) {
      foamBoardFt += line.quantity * scrap;
    }
  }

  const nCuts = nPieces;
  const nJoints = nPieces > 0 ? Math.max(0, Math.round(nPieces * 1.5)) : 0;

  return {
    nPieces: round4(nPieces),
    nCuts: round4(nCuts),
    tubeFt: round4(tubeFt),
    nJoints: round4(nJoints),
    metalAreaFt2: round4(metalAreaFt2),
    fabricYd: round4(fabricYd),
    foamBoardFt: round4(foamBoardFt),
  };
}

export function computeLabor(input: {
  drivers: GeometryDrivers;
  estWeightLbs: number;
  includeCushion?: boolean;
}): LaborResult {
  const d = input.drivers;
  const includeCushion =
    input.includeCushion ?? (d.fabricYd > 0 || d.foamBoardFt > 0);

  const ops: LaborResult["ops"] = [];

  if (d.nCuts > 0 || d.tubeFt > 0) {
    const setup = 5;
    const run = d.nCuts * 0.35;
    ops.push({
      workCenter: "Metal Cutting",
      sequence: 10,
      setupTimeMins: setup,
      runTimeMins: round4(setup + run),
      drivers: { n_cuts: d.nCuts },
    });
  }

  if (d.nJoints > 0 || d.tubeFt > 0) {
    const setup = 10;
    const run = d.nJoints * 1.8 + d.tubeFt * 0.15;
    ops.push({
      workCenter: "Building & Welding",
      sequence: 20,
      setupTimeMins: setup,
      runTimeMins: round4(setup + run),
      drivers: { n_joints: d.nJoints, tube_ft: d.tubeFt },
    });
  }

  if (d.metalAreaFt2 > 0) {
    const setup = 8;
    const run = d.metalAreaFt2 / 12;
    ops.push({
      workCenter: "Metal Powder Coating",
      sequence: 30,
      setupTimeMins: setup,
      runTimeMins: round4(setup + run),
      drivers: { metal_area_ft2: d.metalAreaFt2 },
    });
  }

  if (includeCushion && d.fabricYd > 0) {
    ops.push({
      workCenter: "Fabric Cutting",
      sequence: 40,
      setupTimeMins: 5,
      runTimeMins: round4(5 + d.fabricYd * 1.2),
      drivers: { fabric_yd: d.fabricYd },
    });
    ops.push({
      workCenter: "Fabric Sewing",
      sequence: 50,
      setupTimeMins: 8,
      runTimeMins: round4(8 + d.fabricYd * 2.5),
      drivers: { fabric_yd: d.fabricYd },
    });
  }

  if (includeCushion && d.foamBoardFt > 0) {
    ops.push({
      workCenter: "Cushion Stuffing",
      sequence: 60,
      setupTimeMins: 5,
      runTimeMins: round4(5 + d.foamBoardFt * 0.8),
      drivers: { foam_board_ft: d.foamBoardFt },
    });
  }

  const qcRun = Math.max(5, input.estWeightLbs * 0.05);
  ops.push({
    workCenter: "Quality Check",
    sequence: 90,
    setupTimeMins: 0,
    runTimeMins: round4(qcRun),
    drivers: { est_weight_lbs: input.estWeightLbs },
  });

  const totalMinutes = round4(
    ops.reduce((sum, op) => sum + op.runTimeMins, 0),
  );

  return { totalMinutes, ops };
}
