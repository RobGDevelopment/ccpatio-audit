/**
 * Website OBJ → metal review payload. No database writes. No Katana calls.
 *
 *   npx tsx scripts/ops/extract-website-obj-boms.ts
 *   npx tsx scripts/ops/extract-website-obj-boms.ts --pilot
 *
 * Default reads every OBJ in the website-products folder and writes:
 *   tmp/obj-metal-bom-review.json
 *   tmp/obj-metal-bom-review.csv
 *   tmp/obj-metal-bom-pilot.json   (club chair + Ocean sofa)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { subAssemblySku } from "../../src/lib/heuristic-bom";
import {
  katanaFeetFromNet,
  netFeetFromInches,
  OBJ_ASSUMED_GAUGE,
  OBJ_METAL_SCRAP_FACTOR,
  snapSection,
} from "../../src/lib/obj-cutlist/profile-crosswalk";
import {
  parseObjWeldment,
  type ObjStick,
} from "../../src/lib/obj-cutlist/parse-obj-weldment";
import { generateFinishedGoodSku } from "../../src/lib/sku-engine";

const DEFAULT_DIR = path.join(
  process.cwd(),
  "Blender",
  "Website Products",
  "MTL  files for website products",
);

export const PILOT_FILES = [
  "1 BRAVADA club chair.obj",
  "19 OCEAN sofa 72.obj",
] as const;

const NORTH_STAR_2X2_FT = 29.84;

export type ReviewCut = {
  qtyEa: number;
  longPointIn: number;
  shortPointIn: number | null;
  endA: 45 | 90;
  endB: 45 | 90;
  compoundLongEdges: boolean;
};

export type ReviewRecipe = {
  recipeSku: string | null;
  profileCode: string;
  rejectedPlaceholderSku: string | null;
  assumedGauge: typeof OBJ_ASSUMED_GAUGE;
  pieces: number;
  netFt: number;
  scrapFactor: typeof OBJ_METAL_SCRAP_FACTOR;
  katanaQuantityFt: number;
  scrapAppliedInThisFile: false;
  cuts: ReviewCut[];
  flag: string | null;
};

export type ReviewStick = ObjStick & {
  profileCode: string;
  recipeSku: string | null;
  rejectedPlaceholderSku: string | null;
  assumedGauge: typeof OBJ_ASSUMED_GAUGE;
  flag: string | null;
};

export type FileReview = {
  file: string;
  units: string | null;
  finCandidate: string;
  match: "not_checked";
  proposedParentSku: string;
  status: "measured" | "fused_mesh" | "no_metal" | "bad_units";
  draftEligible: boolean;
  flags: string[];
  sticks: ReviewStick[];
  recipes: ReviewRecipe[];
  omittedStickLike: ReturnType<typeof parseObjWeldment>["omittedStickLike"];
};

function proposeFin(fileName: string): string {
  const stem = fileName.replace(/\.obj$/i, "").replace(/^\d+\s+/, "").trim();
  const collection = stem.split(/\s+/)[0] ?? "";
  return generateFinishedGoodSku(stem, collection, "", "");
}

function filenameMaxIn(fileName: string): number | null {
  const stem = fileName.replace(/\.obj$/i, "");
  const tokens = stem.match(/\b\d{2,3}\b/g);
  if (!tokens?.length) return null;
  return Math.max(...tokens.map(Number));
}

function rollupKey(stick: ReviewStick): string {
  if (stick.recipeSku) return `${stick.recipeSku}|${stick.profileCode}`;
  if (stick.flag === "no_MET_code_for_1x1/8_flat_bar") return stick.flag;
  return `UNMAPPED|${stick.sectionMajorIn}|${stick.sectionMinorIn}|${stick.flag ?? ""}`;
}

function rollup(sticks: ReviewStick[]): ReviewRecipe[] {
  const groups = new Map<string, ReviewStick[]>();
  for (const stick of sticks) {
    const key = rollupKey(stick);
    const list = groups.get(key);
    if (list) list.push(stick);
    else groups.set(key, [stick]);
  }

  const recipes: ReviewRecipe[] = [];
  for (const list of groups.values()) {
    const sample = list[0]!;
    const cutKey = (stick: ReviewStick) =>
      [
        stick.longPointIn,
        stick.shortPointIn ?? "",
        stick.endA,
        stick.endB,
      ].join("|");
    const cuts = new Map<string, ReviewCut>();
    let inches = 0;
    for (const stick of list) {
      inches += stick.longPointIn;
      const key = cutKey(stick);
      const existing = cuts.get(key);
      if (existing) {
        existing.qtyEa += 1;
        existing.compoundLongEdges =
          existing.compoundLongEdges || stick.compoundLongEdges;
      } else {
        cuts.set(key, {
          qtyEa: 1,
          longPointIn: stick.longPointIn,
          shortPointIn: stick.shortPointIn,
          endA: stick.endA,
          endB: stick.endB,
          compoundLongEdges: stick.compoundLongEdges,
        });
      }
    }
    const netFt = netFeetFromInches(inches);
    recipes.push({
      recipeSku: sample.recipeSku,
      profileCode: sample.profileCode,
      rejectedPlaceholderSku: sample.rejectedPlaceholderSku,
      assumedGauge: OBJ_ASSUMED_GAUGE,
      pieces: list.length,
      netFt,
      scrapFactor: OBJ_METAL_SCRAP_FACTOR,
      katanaQuantityFt: katanaFeetFromNet(netFt),
      scrapAppliedInThisFile: false,
      cuts: [...cuts.values()].sort((a, b) => b.longPointIn - a.longPointIn),
      flag: sample.flag,
    });
  }

  return recipes.sort((a, b) => b.netFt - a.netFt);
}

export function reviewObjFile(fileName: string, objText: string): FileReview {
  const parsed = parseObjWeldment(objText);
  const finCandidate = proposeFin(fileName);
  const proposedParentSku = subAssemblySku(finCandidate, "FRAME");

  if (parsed.units != null && parsed.units !== "inches") {
    return {
      file: fileName,
      units: parsed.units,
      finCandidate,
      match: "not_checked",
      proposedParentSku,
      status: "bad_units",
      draftEligible: false,
      flags: ["units_not_inches"],
      sticks: [],
      recipes: [],
      omittedStickLike: [],
    };
  }

  const sticks: ReviewStick[] = parsed.sticks.map((stick) => {
    const snap = snapSection(stick.sectionMajorIn, stick.sectionMinorIn);
    return {
      ...stick,
      profileCode: snap.profileCode,
      recipeSku: snap.purchasingSku,
      rejectedPlaceholderSku: snap.rejectedPlaceholderSku,
      assumedGauge: snap.assumedGauge,
      flag: snap.flag,
    };
  });

  const flags = ["assumed_16_ga"];
  if (sticks.some((stick) => stick.flag === "no_MET_code_for_1x1/8_flat_bar")) {
    flags.push("no_MET_code_for_1x1/8_flat_bar");
  }
  if (sticks.some((stick) => stick.flag === "unmapped_section")) {
    flags.push("unmapped_section");
  }

  const maxNamed = filenameMaxIn(fileName);
  const longest = sticks.reduce(
    (max, stick) => Math.max(max, stick.longPointIn),
    0,
  );
  if (maxNamed == null) flags.push("envelope_unchecked");
  else if (longest <= maxNamed + 6) flags.push("envelope_ok");
  else flags.push("envelope_fail");

  let status: FileReview["status"] = "measured";
  if (sticks.length === 0) {
    status = parsed.largestExtentIn >= 12 ? "fused_mesh" : "no_metal";
  }

  const unmapped = sticks.some((stick) => stick.recipeSku == null);
  const draftEligible =
    status === "measured" &&
    sticks.length > 0 &&
    !unmapped &&
    !flags.includes("envelope_fail");

  return {
    file: fileName,
    units: parsed.units,
    finCandidate,
    match: "not_checked",
    proposedParentSku,
    status,
    draftEligible,
    flags,
    sticks,
    recipes: rollup(sticks),
    omittedStickLike: parsed.omittedStickLike,
  };
}

function csvEscape(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(files: FileReview[]): string {
  const header = [
    "file",
    "fin_candidate",
    "match",
    "parent_sku",
    "profile",
    "recipe_sku",
    "rejected_placeholder_sku",
    "pieces",
    "long_point_in",
    "short_point_in",
    "ends",
    "net_ft",
    "scrap_factor",
    "katana_ft",
    "confidence",
    "flag",
  ];
  const rows = [header.join(",")];
  for (const file of files) {
    if (file.recipes.length === 0) {
      rows.push(
        [
          file.file,
          file.finCandidate,
          file.match,
          file.proposedParentSku,
          "",
          "",
          "",
          0,
          "",
          "",
          "",
          0,
          OBJ_METAL_SCRAP_FACTOR,
          0,
          file.status,
          file.flags.join("|"),
        ]
          .map(csvEscape)
          .join(","),
      );
      continue;
    }
    for (const recipe of file.recipes) {
      for (const cut of recipe.cuts) {
        const cutFt = netFeetFromInches(cut.qtyEa * cut.longPointIn);
        rows.push(
          [
            file.file,
            file.finCandidate,
            file.match,
            file.proposedParentSku,
            recipe.profileCode,
            recipe.recipeSku,
            recipe.rejectedPlaceholderSku,
            cut.qtyEa,
            cut.longPointIn,
            cut.shortPointIn,
            `${cut.endA}/${cut.endB}`,
            cutFt,
            recipe.scrapFactor,
            katanaFeetFromNet(cutFt),
            recipe.recipeSku ? "high" : "unmapped",
            recipe.flag ??
              (cut.compoundLongEdges ? "compound_long_edges" : ""),
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    }
  }
  return `${rows.join("\n")}\n`;
}

function listObjFiles(dir: string, only: readonly string[] | null): string[] {
  const names = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".obj"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!only) return names;
  const wanted = new Set(only);
  return names.filter((name) => wanted.has(name));
}

function summarizePilot(review: FileReview): string[] {
  const lines: string[] = [];
  lines.push(`\n${review.file}`);
  lines.push(
    `  status=${review.status} draftEligible=${review.draftEligible} fin=${review.finCandidate} parent=${review.proposedParentSku}`,
  );
  lines.push(`  flags=${review.flags.join(", ") || "(none)"}`);
  for (const recipe of review.recipes) {
    const sku = recipe.recipeSku ?? "UNMAPPED";
    const ends = recipe.cuts
      .map(
        (cut) =>
          `${cut.qtyEa}×${cut.longPointIn}" ${cut.endA}/${cut.endB}${
            cut.shortPointIn != null ? ` short ${cut.shortPointIn}"` : ""
          }${cut.compoundLongEdges ? " compound" : ""}`,
      )
      .join("; ");
    lines.push(
      `  ${sku} ${recipe.profileCode} pieces=${recipe.pieces} netFt=${recipe.netFt} katanaFt=${recipe.katanaQuantityFt} (scrap not applied) ${recipe.flag ?? ""}`,
    );
    lines.push(`    ${ends}`);
  }
  if (review.file.startsWith("1 BRAVADA")) {
    const tube = review.recipes.find((recipe) => recipe.recipeSku === "MET-TB22060");
    const ft = tube?.netFt ?? 0;
    const lo = NORTH_STAR_2X2_FT * 0.95;
    const hi = NORTH_STAR_2X2_FT * 1.05;
    const pass = ft >= lo && ft <= hi;
    lines.push(
      `  PILOT 2x2 netFt=${ft} vs shop ${NORTH_STAR_2X2_FT} (±5% ${lo.toFixed(2)}–${hi.toFixed(2)}) ${pass ? "PASS" : "FAIL"}`,
    );
  }
  if (review.file.startsWith("19 OCEAN")) {
    const mitre = review.sticks.find(
      (stick) =>
        stick.recipeSku === "MET-TB22060" &&
        stick.endA === 45 &&
        stick.endB === 45 &&
        stick.longPointIn >= 28.5 &&
        stick.longPointIn <= 29.5,
    );
    lines.push(
      mitre
        ? `  PILOT mitre long=${mitre.longPointIn} short=${mitre.shortPointIn} ends=${mitre.endA}/${mitre.endB} sku=${mitre.recipeSku} PASS`
        : "  PILOT mitre 29in 45/45 on MET-TB22060 FAIL",
    );
  }
  return lines;
}

function main(): void {
  const pilotOnly = process.argv.includes("--pilot");
  const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));
  const dir = dirArg ? dirArg.slice("--dir=".length) : DEFAULT_DIR;
  const names = listObjFiles(dir, pilotOnly ? PILOT_FILES : null);
  if (names.length === 0) {
    throw new Error(`No OBJ files in ${dir}`);
  }

  const files = names.map((name) =>
    reviewObjFile(name, readFileSync(path.join(dir, name), "utf8")),
  );
  const outDir = path.join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    scrapFactor: OBJ_METAL_SCRAP_FACTOR,
    scrapAppliedInQuantities: false,
    assumedGauge: OBJ_ASSUMED_GAUGE,
    recipeSkuPolicy: "purchasing MET-* only; RM-MET-* is never the recipe SKU",
    files,
  };

  const reviewPath = path.join(outDir, "obj-metal-bom-review.json");
  const csvPath = path.join(outDir, "obj-metal-bom-review.csv");
  writeFileSync(reviewPath, JSON.stringify(payload, null, 2));
  writeFileSync(csvPath, toCsv(files));

  const pilot = files.filter((file) =>
    PILOT_FILES.some((name) => file.file === name),
  );
  const pilotPath = path.join(outDir, "obj-metal-bom-pilot.json");
  writeFileSync(
    pilotPath,
    JSON.stringify(
      {
        generatedAt: payload.generatedAt,
        scrapFactor: payload.scrapFactor,
        scrapAppliedInQuantities: false,
        assumedGauge: OBJ_ASSUMED_GAUGE,
        recipeSkuPolicy: payload.recipeSkuPolicy,
        files: pilot,
      },
      null,
      2,
    ),
  );

  console.log(`OBJ files: ${files.length}`);
  console.log(`Wrote ${path.relative(process.cwd(), reviewPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), csvPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), pilotPath)}`);
  for (const review of pilot) {
    console.log(summarizePilot(review).join("\n"));
  }
}

const invoked = process.argv[1]
  ?.replace(/\\/g, "/")
  .includes("extract-website-obj-boms");
if (invoked) {
  main();
}
