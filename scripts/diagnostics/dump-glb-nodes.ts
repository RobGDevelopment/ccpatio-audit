/**
 * Dump GLTF scene-graph node names from a .glb (Phase 1 diagnostic).
 *
 * Default target is the untransformed Bravada source — Draco "-transformed"
 * files often collapse SketchUp component strings into Mesh_Frame / Mesh_Seat.
 *
 * Usage (repo root):
 *   npx tsx scripts/diagnostics/dump-glb-nodes.ts
 *   npx tsx scripts/diagnostics/dump-glb-nodes.ts 3d-sandbox/public/models/bravada-swivel.glb
 *   npx tsx scripts/diagnostics/dump-glb-nodes.ts --compare
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const DEFAULT_GLB = path.resolve(
  process.cwd(),
  "3d-sandbox/public/models/bravada-swivel.glb",
);

const COMPARE_TRANSFORMED = path.resolve(
  process.cwd(),
  "3d-sandbox/public/models/bravada-swivel-transformed.glb",
);

type WalkRow = {
  depth: number;
  nodeName: string;
  meshName: string;
  extrasKeys: string[];
  childCount: number;
};

function extrasKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function walk(node: GltfNode, depth: number, rows: WalkRow[]): void {
  const mesh = node.getMesh();
  rows.push({
    depth,
    nodeName: node.getName()?.trim() || "(unnamed)",
    meshName: mesh?.getName()?.trim() || "",
    extrasKeys: extrasKeys(node.getExtras()),
    childCount: node.listChildren().length,
  });
  for (const child of node.listChildren()) {
    walk(child, depth + 1, rows);
  }
}

function looksLikeCutList(name: string): boolean {
  return (
    /\b\d{2,3}\s*"/.test(name) ||
    /\b(45|90)\b/.test(name) ||
    /\b2\s*[xX]\s*2\b/.test(name) ||
    /\b16\s*GA\b/i.test(name) ||
    /\bMITRE|\bMITER|\bRAIL|\bARM\b|\bTUBE/i.test(name)
  );
}

async function dumpFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`GLB not found: ${resolved}`);
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(resolved);
  const root = document.getRoot();
  const scenes = root.listScenes();
  const rows: WalkRow[] = [];

  for (const scene of scenes) {
    for (const child of scene.listChildren()) {
      walk(child, 0, rows);
    }
  }

  console.log("\n============================================================");
  console.log(`FILE: ${resolved}`);
  console.log(`bytes: ${fs.statSync(resolved).size}`);
  console.log(`scenes: ${scenes.length}  scene-graph nodes: ${rows.length}  all nodes: ${root.listNodes().length}`);
  console.log("============================================================\n");

  if (rows.length === 0) {
    console.log("(no nodes attached to a scene — listing root.listNodes())\n");
    for (const node of root.listNodes()) {
      walk(node, 0, rows);
    }
  }

  for (const row of rows) {
    const indent = "  ".repeat(row.depth);
    const extras = row.extrasKeys.length ? ` extras=[${row.extrasKeys.join(",")}]` : "";
    const mesh = row.meshName ? ` mesh="${row.meshName}"` : "";
    console.log(`${indent}- "${row.nodeName}"${mesh} children=${row.childCount}${extras}`);
  }

  const names = rows.map((row) => row.nodeName);
  const unique = new Set(names);
  const unnamed = names.filter((name) => name === "(unnamed)").length;
  const cutLike = names.filter(looksLikeCutList);
  const generic = names.filter((name) => /^Mesh_/i.test(name) || /^Node$/i.test(name));

  console.log("\n--- summary ---");
  console.log(`named unique: ${unique.size}  unnamed: ${unnamed}  Mesh_* / generic: ${generic.length}`);
  console.log(`names that look like SketchUp cut-list strings: ${cutLike.length}`);
  if (cutLike.length > 0) {
    console.log("cut-list-like samples:");
    for (const name of [...new Set(cutLike)].slice(0, 20)) {
      console.log(`  • ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--compare");
  const compare = process.argv.includes("--compare");
  const target = args[0] ? path.resolve(args[0]) : DEFAULT_GLB;

  await dumpFile(target);
  if (compare && fs.existsSync(COMPARE_TRANSFORMED)) {
    await dumpFile(COMPARE_TRANSFORMED);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
