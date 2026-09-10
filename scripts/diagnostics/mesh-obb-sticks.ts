/**
 * Mesh OBB stick-fitter fallback when SketchUp names/groups are missing.
 * Uses @gltf-transform (already a dep) — no Python trimesh required.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/mesh-obb-sticks.ts [path/to/model.glb]
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO, type Mesh, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { WalkerExport, WalkerStick } from "@/lib/sketchup-cutlist";
import { resolveProfile } from "@/lib/sketchup-cutlist";

const DEFAULT_GLB = path.resolve(
  process.cwd(),
  "3d-sandbox/public/models/bravada-swivel.glb",
);

type Vec3 = [number, number, number];

function readPositions(mesh: Mesh): Vec3[] {
  const points: Vec3[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    const arr = pos.getArray();
    if (!arr) continue;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      points.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
    }
  }
  return points;
}

function aabb(points: Vec3[]): { min: Vec3; max: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/** Assume glTF meters → inches when long axis < 5; else already inches. */
function toInches(size: Vec3): Vec3 {
  const longest = Math.max(...size);
  const scale = longest > 0 && longest < 5 ? 39.3701 : 1;
  return [size[0] * scale, size[1] * scale, size[2] * scale];
}

function collectMeshes(node: GltfNode, out: Array<{ name: string; mesh: Mesh }>) {
  const mesh = node.getMesh();
  if (mesh) {
    out.push({
      name: node.getName()?.trim() || mesh.getName()?.trim() || "Mesh",
      mesh,
    });
  }
  for (const child of node.listChildren()) {
    collectMeshes(child, out);
  }
}

function stickFromAabb(
  name: string,
  sizeIn: Vec3,
): WalkerStick | null {
  const dims = [...sizeIn].sort((a, b) => a - b) as Vec3;
  const [short, mid, long] = dims;
  if (long < 6 || long > 120) return null;
  if (long / Math.max(mid, 0.01) < 3.5) return null; // not stick-like

  // Guess 2x2 vs 1.5x0.75 from cross-section
  let profileName = "2X2";
  if (short < 0.4 && mid > 1.0 && mid < 2.2) profileName = "FLAT BAR 1/8";
  else if (Math.abs(mid - 1.5) < 0.4 && Math.abs(short - 0.75) < 0.35) {
    profileName = "1.5X.75";
  }

  const resolved = resolveProfile(`${profileName} ${long.toFixed(1)}"`);
  return {
    definitionName: `${name} ${profileName} ${long.toFixed(1)}" 90 90`,
    parentAsmName: null,
    instanceCount: 1,
    nameLengthIn: Math.round(long * 2) / 2,
    obbLengthIn: Math.round(long * 1000) / 1000,
    endA: 90,
    endB: 90,
    profile: resolved.profile,
    profileWidthIn: resolved.profileWidthIn,
    materialName: null,
    confidence: "low",
  };
}

export async function extractObbSticks(glbPath: string): Promise<WalkerExport> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(glbPath);
  const root = document.getRoot();
  const meshes: Array<{ name: string; mesh: Mesh }> = [];
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) {
      collectMeshes(child, meshes);
    }
  }
  if (meshes.length === 0) {
    for (const node of root.listNodes()) {
      collectMeshes(node, meshes);
    }
  }

  const sticks: WalkerStick[] = [];
  let worldMin: Vec3 = [Infinity, Infinity, Infinity];
  let worldMax: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const { name, mesh } of meshes) {
    const pts = readPositions(mesh);
    if (pts.length < 8) continue;
    const box = aabb(pts);
    for (let i = 0; i < 3; i++) {
      worldMin[i] = Math.min(worldMin[i], box.min[i]);
      worldMax[i] = Math.max(worldMax[i], box.max[i]);
    }
    const sizeIn = toInches(box.size);
    const stick = stickFromAabb(name, sizeIn);
    if (stick) sticks.push(stick);
  }

  const overallSize = toInches([
    worldMax[0] - worldMin[0],
    worldMax[1] - worldMin[1],
    worldMax[2] - worldMin[2],
  ]);
  const sorted = [...overallSize].sort((a, b) => b - a);

  return {
    sourceFile: glbPath,
    exportedAt: new Date().toISOString(),
    productHint: path.basename(glbPath, path.extname(glbPath)),
    overall: {
      lengthIn: Math.round(sorted[0] * 10) / 10,
      depthIn: Math.round(sorted[1] * 10) / 10,
      heightIn: Math.round(sorted[2] * 10) / 10,
    },
    assemblies: [],
    sticks,
    flags: [
      "mesh_obb_fallback",
      "mitres_defaulted_to_90_90",
      "verify_with_family_template_piece_counts",
    ],
    auditBucket: "exploded_soup",
  };
}

async function main(): Promise<void> {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_GLB;
  if (!fs.existsSync(target)) {
    throw new Error(`GLB not found: ${target}`);
  }
  const export_ = await extractObbSticks(target);
  const outDir = path.join(process.cwd(), "scripts", "diagnostics", "cutlist-exports");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(
    outDir,
    `${path.basename(target, path.extname(target))}.mesh-obb.cutlist.json`,
  );
  fs.writeFileSync(out, JSON.stringify(export_, null, 2));
  console.log(
    `OBB sticks=${export_.sticks.length} overall=${export_.overall.lengthIn}x${export_.overall.depthIn}x${export_.overall.heightIn}`,
  );
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

if (process.argv[1]?.includes("mesh-obb-sticks")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
