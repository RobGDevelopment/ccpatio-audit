/**
 * Option B — Collada (.dae) weldment AABB extractor.
 *
 * Legacy SketchUp exports often keep nested groups + instance_geometry but
 * strip manufacturing names. This script reads POSITION float arrays, computes
 * local AABBs (× instance scale), classifies tube profiles, and rolls up qty.
 *
 * Output feeds the same WalkerExport shape as the Ruby/Bravada pipeline so
 * family-templates.ts can consume it later.
 *
 * Usage (repo root):
 *   npx tsx scripts/diagnostics/parse-dae-weldment.ts
 *   npx tsx scripts/diagnostics/parse-dae-weldment.ts docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type {
  ProfileCode,
  WalkerExport,
  WalkerStick,
} from "../../src/lib/sketchup-cutlist/types";
import { resolveProfile } from "../../src/lib/sketchup-cutlist/parse-component-name";

const DEFAULT_DAE = path.resolve(
  process.cwd(),
  "docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae",
);

type Vec3 = [number, number, number];
type Mat4 = number[]; // 16 floats, Collada row-major

type LocalGeom = {
  id: string;
  min: Vec3;
  max: Vec3;
  size: Vec3; // abs extents
};

type InstanceHit = {
  nodeName: string;
  nodeId: string;
  geometryId: string;
  localSize: Vec3;
  scaledSize: Vec3;
  scale: Vec3;
  path: string[];
};

export type TubeRollup = {
  profile: string;
  profileCode: ProfileCode;
  length: number;
  qty: number;
  shortAxes: [number, number];
  nodeSamples: string[];
};

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function parseMatrix(text: string | undefined): Mat4 {
  if (!text?.trim()) return [...IDENTITY];
  const nums = text
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length !== 16) return [...IDENTITY];
  return nums as Mat4;
}

/** Row-major 4×4 multiply: out = a * b */
function mulMat(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as number[];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out as Mat4;
}

/** Absolute scale of each local axis from the upper 3×3 (row-major). */
function matScale(m: Mat4): Vec3 {
  const sx = Math.hypot(m[0], m[4], m[8]);
  const sy = Math.hypot(m[1], m[5], m[9]);
  const sz = Math.hypot(m[2], m[6], m[10]);
  return [
    sx > 1e-9 ? sx : 1,
    sy > 1e-9 ? sy : 1,
    sz > 1e-9 ? sz : 1,
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function aabbFromPositions(values: number[]): LocalGeom["size"] | null {
  if (values.length < 9 || values.length % 3 !== 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < values.length; i += 3) {
    const x = values[i]!;
    const y = values[i + 1]!;
    const z = values[i + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return [maxX - minX, maxY - minY, maxZ - minZ];
}

function stripHash(url: string): string {
  return url.replace(/^#/, "").trim();
}

/**
 * Classify a box as a tube/extrusion profile.
 * Short axes ≈ profile; long axis = cut length (inches).
 */
export function classifyExtrusion(size: Vec3): {
  profile: string;
  profileCode: ProfileCode;
  length: number;
  shortAxes: [number, number];
  isTube: boolean;
} | null {
  const dims = [...size]
    .map((v) => Math.abs(v))
    .sort((a, b) => a - b) as Vec3;
  const [short, mid, long] = dims;
  if (long < 10) return null;
  if (long / Math.max(mid, 0.01) < 2.5) return null; // slab / plate-ish

  const near = (a: number, b: number, tol = 0.35) => Math.abs(a - b) <= tol;

  let profile = "UNKNOWN";
  let profileCode: ProfileCode = "UNKNOWN";

  if (near(short, 2, 0.45) && near(mid, 2, 0.45)) {
    profile = "2x2";
    profileCode = "SQ2-16";
  } else if (
    (near(short, 0.75, 0.3) && near(mid, 1.5, 0.35)) ||
    (near(short, 1.5, 0.35) && near(mid, 0.75, 0.3))
  ) {
    profile = "1.5x0.75";
    profileCode = "RT1.5x0.75-16";
  } else if (near(short, 1, 0.35) && near(mid, 2, 0.45)) {
    profile = "2x1";
    profileCode = "SQ2x1-16";
  } else if (short < 0.35 && mid >= 0.75 && mid <= 2.25) {
    profile = "flatbar";
    profileCode = "FB0.125x1.5";
  } else if (near(short, mid, 0.5) && short >= 0.75 && short <= 2.5) {
    // Near-square unknown gauge — still a tube
    profile = `${round2(short)}x${round2(mid)}`;
    profileCode = resolveProfile(`2X2`).profile;
  } else {
    return null;
  }

  return {
    profile,
    profileCode,
    length: roundHalf(long),
    shortAxes: [round2(short), round2(mid)],
    isTube: true,
  };
}

function loadGeometries($: cheerio.CheerioAPI): Map<string, LocalGeom> {
  const map = new Map<string, LocalGeom>();

  $("geometry").each((_, geomEl) => {
    const id = $(geomEl).attr("id");
    if (!id) return;

    // POSITION source via <vertices><input semantic="POSITION" source="#…"/>
    const posSourceUrl = $(geomEl)
      .find("vertices input[semantic='POSITION']")
      .first()
      .attr("source");
    if (!posSourceUrl) return;
    const sourceId = stripHash(posSourceUrl);
    const source = $(geomEl).find(`source[id='${sourceId}']`).first();
    const floatText =
      source.find("float_array").first().text() ||
      // fallback: first float_array under mesh (SketchUp POSITION is first)
      $(geomEl).find("mesh > source").first().find("float_array").first().text();

    const values = floatText
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const size = aabbFromPositions(values);
    if (!size) return;

    map.set(id, {
      id,
      min: [0, 0, 0],
      max: size,
      size,
    });
  });

  return map;
}

function walkScene(
  $: cheerio.CheerioAPI,
  geometries: Map<string, LocalGeom>,
): InstanceHit[] {
  const hits: InstanceHit[] = [];

  function walk(
    node: cheerio.Element,
    parentMat: Mat4,
    path: string[],
  ): void {
    const $node = $(node);
    const name = $node.attr("name") || $node.attr("id") || "node";
    if (name.startsWith("skp_camera")) return;

    const localMat = parseMatrix($node.children("matrix").first().text());
    const world = mulMat(parentMat, localMat);
    const nextPath = [...path, name];

    $node.children("instance_geometry").each((_, inst) => {
      const url = $(inst).attr("url");
      if (!url) return;
      const geomId = stripHash(url);
      const geom = geometries.get(geomId);
      if (!geom) return;
      const scale = matScale(world);
      const scaledSize: Vec3 = [
        geom.size[0] * scale[0],
        geom.size[1] * scale[1],
        geom.size[2] * scale[2],
      ];
      hits.push({
        nodeName: name,
        nodeId: $node.attr("id") || "",
        geometryId: geomId,
        localSize: geom.size,
        scaledSize,
        scale,
        path: nextPath,
      });
    });

    $node.children("node").each((_, child) => {
      walk(child, world, nextPath);
    });
  }

  $("visual_scene")
    .children("node")
    .each((_, root) => walk(root, [...IDENTITY], []));

  return hits;
}

export function rollupTubes(hits: InstanceHit[]): TubeRollup[] {
  const buckets = new Map<string, TubeRollup>();

  for (const hit of hits) {
    const classified = classifyExtrusion(hit.scaledSize);
    if (!classified) continue;
    const key = `${classified.profile}|${classified.length}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.qty += 1;
      if (existing.nodeSamples.length < 4) {
        existing.nodeSamples.push(hit.nodeName);
      }
    } else {
      buckets.set(key, {
        profile: classified.profile,
        profileCode: classified.profileCode,
        length: classified.length,
        qty: 1,
        shortAxes: classified.shortAxes,
        nodeSamples: [hit.nodeName],
      });
    }
  }

  return [...buckets.values()].sort(
    (a, b) => b.length - a.length || a.profile.localeCompare(b.profile),
  );
}

function toWalkerExport(
  filePath: string,
  hits: InstanceHit[],
  rollup: TubeRollup[],
  unitName: string,
): WalkerExport {
  const sticks: WalkerStick[] = [];
  for (const hit of hits) {
    const c = classifyExtrusion(hit.scaledSize);
    if (!c) continue;
    sticks.push({
      definitionName: `${hit.nodeName} ${c.profile} ${c.length}" 90 90`,
      parentAsmName: hit.path.length >= 2 ? hit.path[hit.path.length - 2]! : null,
      instanceCount: 1,
      nameLengthIn: c.length,
      obbLengthIn: c.length,
      endA: 90,
      endB: 90,
      profile: c.profileCode,
      profileWidthIn: Math.max(...c.shortAxes),
      materialName: null,
      confidence: "low",
    });
  }

  // Collapse identical definition strings into instance counts
  const byDef = new Map<string, WalkerStick>();
  for (const stick of sticks) {
    const key = `${stick.definitionName}|${stick.parentAsmName ?? ""}`;
    const prev = byDef.get(key);
    if (prev) prev.instanceCount += 1;
    else byDef.set(key, { ...stick });
  }

  const overallHint = path.basename(filePath).match(/(\d+)X(\d+)/i);
  return {
    sourceFile: filePath,
    exportedAt: new Date().toISOString(),
    productHint: path.basename(filePath, path.extname(filePath)),
    overall: {
      lengthIn: overallHint ? Number(overallHint[1]) : null,
      depthIn: overallHint ? Number(overallHint[2]) : null,
      heightIn: null,
    },
    assemblies: [],
    sticks: [...byDef.values()],
    flags: [
      "option_b_dae_aabb",
      "mitres_defaulted_to_90_90",
      `collada_unit=${unitName}`,
      `tube_rollups=${rollup.length}`,
    ],
    auditBucket: "nested_groups",
  };
}

export function parseDaeWeldment(daePath: string): {
  unit: string;
  geometries: number;
  instances: number;
  hits: InstanceHit[];
  rollup: TubeRollup[];
  draft: Array<{ profile: string; length: number; qty: number }>;
  walker: WalkerExport;
} {
  const xml = fs.readFileSync(daePath, "utf8");
  const $ = cheerio.load(xml, { xml: { xmlMode: true } });

  const unitName = $("asset unit").attr("name") || "unknown";
  const geometries = loadGeometries($);
  const hits = walkScene($, geometries);
  const rollup = rollupTubes(hits);
  const draft = rollup.map((r) => ({
    profile: r.profile,
    length: r.length,
    qty: r.qty,
  }));
  const walker = toWalkerExport(daePath, hits, rollup, unitName);

  return {
    unit: unitName,
    geometries: geometries.size,
    instances: hits.length,
    hits,
    rollup,
    draft,
    walker,
  };
}

function main(): void {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_DAE;

  if (!fs.existsSync(target)) {
    throw new Error(`DAE not found: ${target}`);
  }

  const result = parseDaeWeldment(target);

  console.log("=== Option B — DAE weldment AABB ===");
  console.log(`file: ${path.relative(process.cwd(), target)}`);
  console.log(`unit: ${result.unit}`);
  console.log(
    `geometries: ${result.geometries}  instance_geometry hits: ${result.instances}`,
  );
  console.log("\n--- per-instance (scaled local AABB) ---");
  for (const hit of result.hits) {
    const c = classifyExtrusion(hit.scaledSize);
    const label = c
      ? `${c.profile} L=${c.length}"`
      : `unclassified [${hit.scaledSize.map(round2).join("×")}]`;
    console.log(
      `  ${hit.nodeName.padEnd(12)} geom=${hit.geometryId.padEnd(6)} local=[${hit.localSize.map(round2).join("×")}] scaled=[${hit.scaledSize.map(round2).join("×")}] → ${label}`,
    );
  }

  console.log("\n--- draft cut-list (grouped) ---");
  console.log(JSON.stringify(result.draft, null, 2));

  console.log("\n--- detailed rollup ---");
  console.log(JSON.stringify(result.rollup, null, 2));

  const outDir = path.join(
    process.cwd(),
    "scripts/diagnostics/cutlist-exports",
  );
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(target, path.extname(target));
  const draftPath = path.join(outDir, `${base}.dae-draft.json`);
  const walkerPath = path.join(outDir, `${base}.cutlist.json`);
  fs.writeFileSync(draftPath, JSON.stringify(result.draft, null, 2));
  fs.writeFileSync(walkerPath, JSON.stringify(result.walker, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), draftPath)}`);
  console.log(
    `Wrote ${path.relative(process.cwd(), walkerPath)} (WalkerExport for family-templates)`,
  );
}

if (process.argv[1]?.includes("parse-dae-weldment")) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
