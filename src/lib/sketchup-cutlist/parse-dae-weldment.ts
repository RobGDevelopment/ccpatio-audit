/**
 * Option B — Collada (.dae) weldment AABB extractor (library).
 * Accepts file path or XML string/Buffer for upload pipeline / CLI.
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { ProfileCode, WalkerExport, WalkerStick } from "./types";
import { resolveProfile } from "./parse-component-name";

type Vec3 = [number, number, number];
type Mat4 = number[];

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

export type ParseDaeResult = {
  unit: string;
  geometries: number;
  instances: number;
  hits: InstanceHit[];
  rollup: TubeRollup[];
  draft: Array<{ profile: string; length: number; qty: number }>;
  walker: WalkerExport;
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

function mulMat(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as number[];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0]! * b[0 * 4 + c]! +
        a[r * 4 + 1]! * b[1 * 4 + c]! +
        a[r * 4 + 2]! * b[2 * 4 + c]! +
        a[r * 4 + 3]! * b[3 * 4 + c]!;
    }
  }
  return out as Mat4;
}

function matScale(m: Mat4): Vec3 {
  const sx = Math.hypot(m[0]!, m[4]!, m[8]!);
  const sy = Math.hypot(m[1]!, m[5]!, m[9]!);
  const sz = Math.hypot(m[2]!, m[6]!, m[10]!);
  return [sx > 1e-9 ? sx : 1, sy > 1e-9 ? sy : 1, sz > 1e-9 ? sz : 1];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function aabbFromPositions(values: number[]): Vec3 | null {
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

function loadGeometries($: cheerio.CheerioAPI): Map<string, { size: Vec3, raw: number[] }> {
  const map = new Map<string, { size: Vec3, raw: number[] }>();
  $("library_geometries geometry").each((_, el) => {
    const id = $(el).attr("id");
    if (!id) return;
    const floatText = $(el).find("float_array").first().text();
    const values = floatText
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const size = aabbFromPositions(values);
    if (size) map.set(id, { size, raw: values });
  });
  return map;
}

function walkScene(
  $: cheerio.CheerioAPI,
  geometries: Map<string, { size: Vec3, raw: number[] }>,
): { hits: InstanceHit[], globalAabb: Vec3 | null } {
  const hits: InstanceHit[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  function walk(node: unknown, parentMat: Mat4, pathParts: string[]): void {
    // cheerio's Element type is not exported from the package namespace in v1.
    const $node = $(node as never);
    const name = $node.attr("name") || $node.attr("id") || "node";
    if (/^skp_camera/i.test(name)) return;

    let mat = parentMat;
    const matrixText = $node.children("matrix").first().text();
    if (matrixText.trim()) {
      mat = mulMat(parentMat, parseMatrix(matrixText));
    }

    const nextPath = [...pathParts, name];
    $node.children("instance_geometry").each((_, ig) => {
      const url = ($(ig).attr("url") || "").replace(/^#/, "");
      const geo = geometries.get(url);
      if (!geo) return;
      const { size: localSize, raw } = geo;
      
      for (let i = 0; i < raw.length; i += 3) {
        const lx = raw[i]!, ly = raw[i+1]!, lz = raw[i+2]!;
        const gx = lx*mat[0]! + ly*mat[4]! + lz*mat[8]! + mat[12]!;
        const gy = lx*mat[1]! + ly*mat[5]! + lz*mat[9]! + mat[13]!;
        const gz = lx*mat[2]! + ly*mat[6]! + lz*mat[10]! + mat[14]!;
        minX = Math.min(minX, gx);
        minY = Math.min(minY, gy);
        minZ = Math.min(minZ, gz);
        maxX = Math.max(maxX, gx);
        maxY = Math.max(maxY, gy);
        maxZ = Math.max(maxZ, gz);
      }

      const scale = matScale(mat);
      const scaledSize: Vec3 = [
        localSize[0] * scale[0],
        localSize[1] * scale[1],
        localSize[2] * scale[2],
      ];
      hits.push({
        nodeName: name,
        nodeId: $node.attr("id") || name,
        geometryId: url,
        localSize,
        scaledSize,
        scale,
        path: nextPath,
      });
    });

    $node.children("node").each((_, child) => {
      walk(child, mat, nextPath);
    });
  }

  $("library_visual_scenes visual_scene > node").each((_, el) => {
    walk(el, IDENTITY, []);
  });
  
  const globalAabb = minX === Infinity ? null : [maxX - minX, maxY - minY, maxZ - minZ] as Vec3;
  return { hits, globalAabb };
}

export function classifyExtrusion(size: Vec3): {
  profile: string;
  profileCode: ProfileCode;
  length: number;
  shortAxes: [number, number];
} | null {
  const sorted = [...size].sort((a, b) => b - a) as Vec3;
  const [long, mid, short] = sorted;
  if (long < 10) return null;
  if (long / mid < 2.5) return null;
  const a = roundHalf(mid);
  const b = roundHalf(short);
  const length = round2(long);
  const profileHint = `${a}x${b}`;
  const resolved = resolveProfile(profileHint);
  return {
    profile: profileHint,
    profileCode: resolved.profile,
    length,
    shortAxes: [a, b],
  };
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
      if (existing.nodeSamples.length < 4) existing.nodeSamples.push(hit.nodeName);
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
  sourceLabel: string,
  hits: InstanceHit[],
  rollup: TubeRollup[],
  unitName: string,
  globalAabb: Vec3 | null,
): WalkerExport {
  const sticks: WalkerStick[] = [];
  for (const hit of hits) {
    const c = classifyExtrusion(hit.scaledSize);
    if (!c) continue;
    sticks.push({
      definitionName: `${hit.nodeName} ${c.profile} ${c.length}" 90 90`,
      parentAsmName:
        hit.path.length >= 2 ? hit.path[hit.path.length - 2]! : null,
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

  const byDef = new Map<string, WalkerStick>();
  for (const stick of sticks) {
    const key = `${stick.definitionName}|${stick.parentAsmName ?? ""}`;
    const prev = byDef.get(key);
    if (prev) prev.instanceCount += 1;
    else byDef.set(key, { ...stick });
  }

  const base = path.basename(sourceLabel);
  const overallHint = base.match(/(\d+)X(\d+)/i);
  const l = globalAabb ? roundHalf(globalAabb[0]) : (overallHint ? Number(overallHint[1]) : null);
  const d = globalAabb ? roundHalf(globalAabb[1]) : (overallHint ? Number(overallHint[2]) : null);
  const h = globalAabb ? roundHalf(globalAabb[2]) : null;

  return {
    sourceFile: sourceLabel,
    exportedAt: new Date().toISOString(),
    productHint: path.basename(base, path.extname(base)),
    overall: {
      lengthIn: l,
      depthIn: d,
      heightIn: h,
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

export function parseDaeWeldmentFromXml(
  xmlInput: string | Buffer,
  sourceLabel: string,
): ParseDaeResult {
  const xml =
    typeof xmlInput === "string" ? xmlInput : xmlInput.toString("utf8");
  const $ = cheerio.load(xml, { xml: { xmlMode: true } });
  const unitNode = $("asset unit");
  const unitName = unitNode.attr("name") || "unknown";
  const meterVal = Number(unitNode.attr("meter")) || 0.0254;
  const inchesPerUnit = meterVal * 39.3701;

  const geometries = loadGeometries($);
  const { hits, globalAabb } = walkScene($, geometries);
  
  const scaledGlobalAabb = globalAabb ? [
    globalAabb[0] * inchesPerUnit,
    globalAabb[1] * inchesPerUnit,
    globalAabb[2] * inchesPerUnit,
  ] as Vec3 : null;

  const rollup = rollupTubes(hits);
  return {
    unit: unitName,
    geometries: geometries.size,
    instances: hits.length,
    hits,
    rollup,
    draft: rollup.map((r) => ({
      profile: r.profile,
      length: r.length,
      qty: r.qty,
    })),
    walker: toWalkerExport(sourceLabel, hits, rollup, unitName, scaledGlobalAabb),
  };
}

export function parseDaeWeldment(daePath: string): ParseDaeResult {
  return parseDaeWeldmentFromXml(fs.readFileSync(daePath, "utf8"), daePath);
}
